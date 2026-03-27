import type { AcpTurnAttachment } from "../../acp/control-plane/manager.types.js";
import { resolveRuntimeOptionsFromMeta } from "../../acp/control-plane/runtime-options.js";
import { resolveAcpAgentPolicyError, resolveAcpDispatchPolicyError } from "../../acp/policy.js";
import { formatAcpRuntimeErrorText } from "../../acp/runtime/error-text.js";
import { toAcpRuntimeError } from "../../acp/runtime/errors.js";
import { resolveAcpThreadSessionDetailLines } from "../../acp/runtime/session-identifiers.js";
import {
  isSessionIdentityPending,
  resolveSessionIdentityFromMeta,
} from "../../acp/runtime/session-identity.js";
import { readAcpSessionEntry } from "../../acp/runtime/session-meta.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { TtsAutoMode } from "../../config/types.tts.js";
import { logVerbose } from "../../globals.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { generateSecureUuid } from "../../infra/secure-random.js";
import { prefixSystemMessage } from "../../infra/system-message.js";
import { withTimeout } from "../../node-host/with-timeout.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { resolveStatusTtsSnapshot } from "../../tts/status-config.js";
import { resolveConfiguredTtsMode } from "../../tts/tts-config.js";
import type { FinalizedMsgContext } from "../templating.js";
import { createAcpReplyProjector } from "./acp-projector.js";
import {
  createAcpDispatchDeliveryCoordinator,
  type AcpDispatchDeliveryCoordinator,
} from "./dispatch-acp-delivery.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";

let dispatchAcpMediaRuntimePromise: Promise<
  typeof import("./dispatch-acp-media.runtime.js")
> | null = null;
let dispatchAcpManagerRuntimePromise: Promise<
  typeof import("./dispatch-acp-manager.runtime.js")
> | null = null;
let dispatchAcpSessionRuntimePromise: Promise<
  typeof import("./dispatch-acp-session.runtime.js")
> | null = null;
let dispatchAcpTtsRuntimePromise: Promise<typeof import("./dispatch-acp-tts.runtime.js")> | null =
  null;

function loadDispatchAcpMediaRuntime() {
  dispatchAcpMediaRuntimePromise ??= import("./dispatch-acp-media.runtime.js");
  return dispatchAcpMediaRuntimePromise;
}

function loadDispatchAcpManagerRuntime() {
  dispatchAcpManagerRuntimePromise ??= import("./dispatch-acp-manager.runtime.js");
  return dispatchAcpManagerRuntimePromise;
}

function loadDispatchAcpSessionRuntime() {
  dispatchAcpSessionRuntimePromise ??= import("./dispatch-acp-session.runtime.js");
  return dispatchAcpSessionRuntimePromise;
}

function loadDispatchAcpTtsRuntime() {
  dispatchAcpTtsRuntimePromise ??= import("./dispatch-acp-tts.runtime.js");
  return dispatchAcpTtsRuntimePromise;
}

type DispatchProcessedRecorder = (
  outcome: "completed" | "skipped" | "error",
  opts?: {
    reason?: string;
    error?: string;
  },
) => void;

function resolveFirstContextText(
  ctx: FinalizedMsgContext,
  keys: Array<"BodyForAgent" | "BodyForCommands" | "CommandBody" | "RawBody" | "Body">,
): string {
  for (const key of keys) {
    const value = ctx[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function resolveAcpPromptText(ctx: FinalizedMsgContext): string {
  return resolveFirstContextText(ctx, [
    "BodyForAgent",
    "BodyForCommands",
    "CommandBody",
    "RawBody",
    "Body",
  ]).trim();
}

function hasInboundMediaForAcp(ctx: FinalizedMsgContext): boolean {
  return Boolean(
    ctx.StickerMediaIncluded ||
    ctx.Sticker ||
    ctx.MediaPath?.trim() ||
    ctx.MediaUrl?.trim() ||
    ctx.MediaPaths?.some((value) => value?.trim()) ||
    ctx.MediaUrls?.some((value) => value?.trim()) ||
    ctx.MediaTypes?.length,
  );
}

const ACP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ACP_ATTACHMENT_TIMEOUT_MS = 1_000;

async function resolveAcpAttachments(
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): Promise<AcpTurnAttachment[]> {
  const {
    MediaAttachmentCache,
    isMediaUnderstandingSkipError,
    normalizeAttachments,
    resolveMediaAttachmentLocalRoots,
  } = await loadDispatchAcpMediaRuntime();
  const mediaAttachments = normalizeAttachments(ctx).map((attachment) =>
    attachment.path?.trim() ? { ...attachment, url: undefined } : attachment,
  );
  const cache = new MediaAttachmentCache(mediaAttachments, {
    localPathRoots: resolveMediaAttachmentLocalRoots({ cfg, ctx }),
  });
  const results: AcpTurnAttachment[] = [];
  for (const attachment of mediaAttachments) {
    const mediaType = attachment.mime ?? "application/octet-stream";
    if (!mediaType.startsWith("image/")) {
      continue;
    }
    if (!attachment.path?.trim()) {
      continue;
    }
    try {
      const { buffer } = await cache.getBuffer({
        attachmentIndex: attachment.index,
        maxBytes: ACP_ATTACHMENT_MAX_BYTES,
        timeoutMs: ACP_ATTACHMENT_TIMEOUT_MS,
      });
      results.push({
        mediaType,
        data: buffer.toString("base64"),
      });
    } catch (error) {
      if (isMediaUnderstandingSkipError(error)) {
        logVerbose(`dispatch-acp: skipping attachment #${attachment.index + 1} (${error.reason})`);
      } else {
        const errorName = error instanceof Error ? error.name : typeof error;
        logVerbose(
          `dispatch-acp: failed to read attachment #${attachment.index + 1} (${errorName})`,
        );
      }
      // Skip unreadable files. Text content should still be delivered.
    }
  }
  return results;
}

function resolveAcpRequestId(ctx: FinalizedMsgContext): string {
  const id = ctx.MessageSidFull ?? ctx.MessageSid ?? ctx.MessageSidFirst ?? ctx.MessageSidLast;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }
  if (typeof id === "number" || typeof id === "bigint") {
    return String(id);
  }
  return generateSecureUuid();
}

async function hasBoundConversationForSession(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  channelRaw: string | undefined;
  accountIdRaw: string | undefined;
}): Promise<boolean> {
  const channel = String(params.channelRaw ?? "")
    .trim()
    .toLowerCase();
  if (!channel) {
    return false;
  }
  const accountId = String(params.accountIdRaw ?? "")
    .trim()
    .toLowerCase();
  const channels = params.cfg.channels as Record<string, { defaultAccount?: unknown } | undefined>;
  const configuredDefaultAccountId = channels?.[channel]?.defaultAccount;
  const normalizedAccountId =
    accountId ||
    (typeof configuredDefaultAccountId === "string" && configuredDefaultAccountId.trim()
      ? configuredDefaultAccountId.trim().toLowerCase()
      : "default");
  const { getSessionBindingService } = await loadDispatchAcpManagerRuntime();
  const bindingService = getSessionBindingService();
  const bindings = bindingService.listBySession(params.sessionKey);
  return bindings.some((binding) => {
    const bindingChannel = String(binding.conversation.channel ?? "")
      .trim()
      .toLowerCase();
    const bindingAccountId = String(binding.conversation.accountId ?? "")
      .trim()
      .toLowerCase();
    const conversationId = String(binding.conversation.conversationId ?? "").trim();
    return (
      bindingChannel === channel &&
      (bindingAccountId || "default") === normalizedAccountId &&
      conversationId.length > 0
    );
  });
}

function resolveDispatchAccountId(params: {
  cfg: OpenClawConfig;
  channelRaw: string | undefined;
  accountIdRaw: string | undefined;
}): string | undefined {
  const channel = String(params.channelRaw ?? "")
    .trim()
    .toLowerCase();
  if (!channel) {
    return params.accountIdRaw?.trim() || undefined;
  }
  const explicit = params.accountIdRaw?.trim();
  if (explicit) {
    return explicit;
  }
  const channels = params.cfg.channels as Record<string, { defaultAccount?: unknown } | undefined>;
  const configuredDefaultAccountId = channels?.[channel]?.defaultAccount;
  return typeof configuredDefaultAccountId === "string" && configuredDefaultAccountId.trim()
    ? configuredDefaultAccountId.trim()
    : undefined;
}

export type AcpDispatchAttemptResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};

const ACP_STALE_BINDING_UNBIND_REASON = "acp-session-init-failed";

function isStaleSessionInitError(params: { code: string; message: string }): boolean {
  if (params.code !== "ACP_SESSION_INIT_FAILED") {
    return false;
  }
  return /(ACP (session )?metadata is missing|missing ACP metadata|Session is not ACP-enabled|Resource not found)/i.test(
    params.message,
  );
}

async function maybeUnbindStaleBoundConversations(params: {
  targetSessionKey: string;
  error: { code: string; message: string };
}): Promise<void> {
  if (!isStaleSessionInitError(params.error)) {
    return;
  }
  try {
    const { getSessionBindingService } = await loadDispatchAcpManagerRuntime();
    const removed = await getSessionBindingService().unbind({
      targetSessionKey: params.targetSessionKey,
      reason: ACP_STALE_BINDING_UNBIND_REASON,
    });
    if (removed.length > 0) {
      logVerbose(
        `dispatch-acp: removed ${removed.length} stale bound conversation(s) for ${params.targetSessionKey} after ${params.error.code}: ${params.error.message}`,
      );
    }
  } catch (error) {
    logVerbose(
      `dispatch-acp: failed to unbind stale bound conversations for ${params.targetSessionKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function finalizeAcpTurnOutput(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  delivery: AcpDispatchDeliveryCoordinator;
  inboundAudio: boolean;
  sessionTtsAuto?: TtsAutoMode;
  ttsChannel?: string;
  shouldEmitResolvedIdentityNotice: boolean;
}): Promise<boolean> {
  await params.delivery.settleVisibleText();
  let queuedFinal =
    params.delivery.hasDeliveredVisibleText() && !params.delivery.hasFailedVisibleTextDelivery();
  const ttsMode = resolveConfiguredTtsMode(params.cfg);
  const accumulatedBlockText = params.delivery.getAccumulatedBlockText();
  const hasAccumulatedBlockText = accumulatedBlockText.trim().length > 0;
  const ttsStatus = resolveStatusTtsSnapshot({
    cfg: params.cfg,
    sessionAuto: params.sessionTtsAuto,
  });
  const canAttemptFinalTts =
    ttsStatus != null && !(ttsStatus.autoMode === "inbound" && !params.inboundAudio);

  let finalMediaDelivered = false;
  if (ttsMode === "final" && hasAccumulatedBlockText && canAttemptFinalTts) {
    try {
      const { maybeApplyTtsToPayload } = await loadDispatchAcpTtsRuntime();
      const ttsSyntheticReply = await maybeApplyTtsToPayload({
        payload: { text: accumulatedBlockText },
        cfg: params.cfg,
        channel: params.ttsChannel,
        kind: "final",
        inboundAudio: params.inboundAudio,
        ttsAuto: params.sessionTtsAuto,
      });
      if (ttsSyntheticReply.mediaUrl) {
        const delivered = await params.delivery.deliver("final", {
          mediaUrl: ttsSyntheticReply.mediaUrl,
          audioAsVoice: ttsSyntheticReply.audioAsVoice,
        });
        queuedFinal = queuedFinal || delivered;
        finalMediaDelivered = delivered;
      }
    } catch (err) {
      logVerbose(
        `dispatch-acp: accumulated ACP block TTS failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Some ACP parent surfaces only expose terminal replies, so block routing alone is not enough
  // to prove the final result was visible to the user.
  const shouldDeliverTextFallback =
    ttsMode !== "all" &&
    hasAccumulatedBlockText &&
    !finalMediaDelivered &&
    !params.delivery.hasDeliveredFinalReply() &&
    (!params.delivery.hasDeliveredVisibleText() || params.delivery.hasFailedVisibleTextDelivery());
  if (shouldDeliverTextFallback) {
    const delivered = await params.delivery.deliver(
      "final",
      { text: accumulatedBlockText },
      { skipTts: true },
    );
    queuedFinal = queuedFinal || delivered;
  }

  if (params.shouldEmitResolvedIdentityNotice) {
    const { readAcpSessionEntry } = await loadDispatchAcpSessionRuntime();
    const currentMeta = readAcpSessionEntry({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
    })?.acp;
    const identityAfterTurn = resolveSessionIdentityFromMeta(currentMeta);
    if (!isSessionIdentityPending(identityAfterTurn)) {
      const resolvedDetails = resolveAcpThreadSessionDetailLines({
        sessionKey: params.sessionKey,
        meta: currentMeta,
      });
      if (resolvedDetails.length > 0) {
        const delivered = await params.delivery.deliver("final", {
          text: prefixSystemMessage(["Session ids resolved.", ...resolvedDetails].join("\n")),
        });
        queuedFinal = queuedFinal || delivered;
      }
    }
  }

  return queuedFinal;
}

export async function tryDispatchAcpReply(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
  runId?: string;
  sessionKey?: string;
  abortSignal?: AbortSignal;
  inboundAudio: boolean;
  sessionTtsAuto?: TtsAutoMode;
  ttsChannel?: string;
  suppressUserDelivery?: boolean;
  shouldRouteToOriginating: boolean;
  originatingChannel?: string;
  originatingTo?: string;
  shouldSendToolSummaries: boolean;
  bypassForCommand: boolean;
  onReplyStart?: () => Promise<void> | void;
  recordProcessed: DispatchProcessedRecorder;
  markIdle: (reason: string) => void;
}): Promise<AcpDispatchAttemptResult | null> {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey || params.bypassForCommand) {
    return null;
  }

  const { getAcpSessionManager } = await loadDispatchAcpManagerRuntime();
  const acpManager = getAcpSessionManager();
  const acpResolution = acpManager.resolveSession({
    cfg: params.cfg,
    sessionKey,
  });
  if (acpResolution.kind === "none") {
    return null;
  }
  const canonicalSessionKey = acpResolution.sessionKey;

  let queuedFinal = false;
  const delivery = createAcpDispatchDeliveryCoordinator({
    cfg: params.cfg,
    ctx: params.ctx,
    dispatcher: params.dispatcher,
    inboundAudio: params.inboundAudio,
    sessionTtsAuto: params.sessionTtsAuto,
    ttsChannel: params.ttsChannel,
    suppressUserDelivery: params.suppressUserDelivery,
    shouldRouteToOriginating: params.shouldRouteToOriginating,
    originatingChannel: params.originatingChannel,
    originatingTo: params.originatingTo,
    onReplyStart: params.onReplyStart,
  });

  const identityPendingBeforeTurn = isSessionIdentityPending(
    resolveSessionIdentityFromMeta(acpResolution.kind === "ready" ? acpResolution.meta : undefined),
  );
  const shouldEmitResolvedIdentityNotice =
    !params.suppressUserDelivery &&
    identityPendingBeforeTurn &&
    (Boolean(params.ctx.MessageThreadId != null && String(params.ctx.MessageThreadId).trim()) ||
      (await hasBoundConversationForSession({
        cfg: params.cfg,
        sessionKey: canonicalSessionKey,
        channelRaw: params.ctx.OriginatingChannel ?? params.ctx.Surface ?? params.ctx.Provider,
        accountIdRaw: params.ctx.AccountId,
      })));

  const resolvedAcpAgent =
    acpResolution.kind === "ready"
      ? (
          acpResolution.meta.agent?.trim() ||
          params.cfg.acp?.defaultAgent?.trim() ||
          resolveAgentIdFromSessionKey(canonicalSessionKey)
        ).trim()
      : resolveAgentIdFromSessionKey(canonicalSessionKey);
  const effectiveDispatchAccountId = resolveDispatchAccountId({
    cfg: params.cfg,
    channelRaw: params.ctx.OriginatingChannel ?? params.ctx.Surface ?? params.ctx.Provider,
    accountIdRaw: params.ctx.AccountId,
  });
  const projector = createAcpReplyProjector({
    cfg: params.cfg,
    shouldSendToolSummaries: params.shouldSendToolSummaries,
    deliver: delivery.deliver,
    provider: params.ctx.Surface ?? params.ctx.Provider,
    accountId: effectiveDispatchAccountId,
  });

  const acpDispatchStartedAt = Date.now();
  try {
    const dispatchPolicyError = resolveAcpDispatchPolicyError(params.cfg);
    if (dispatchPolicyError) {
      throw dispatchPolicyError;
    }
    if (acpResolution.kind === "stale") {
      await maybeUnbindStaleBoundConversations({
        targetSessionKey: canonicalSessionKey,
        error: acpResolution.error,
      });
      const delivered = await delivery.deliver("final", {
        text: formatAcpRuntimeErrorText(acpResolution.error),
        isError: true,
      });
      const counts = params.dispatcher.getQueuedCounts();
      delivery.applyRoutedCounts(counts);
      const acpStats = acpManager.getObservabilitySnapshot(params.cfg);
      logVerbose(
        `acp-dispatch: session=${sessionKey} outcome=error code=${acpResolution.error.code} latencyMs=${Date.now() - acpDispatchStartedAt} queueDepth=${acpStats.turns.queueDepth} activeRuntimes=${acpStats.runtimeCache.activeSessions}`,
      );
      params.recordProcessed("completed", {
        reason: `acp_error:${acpResolution.error.code.toLowerCase()}`,
      });
      params.markIdle("message_completed");
      return { queuedFinal: delivered, counts };
    }
    const agentPolicyError = resolveAcpAgentPolicyError(params.cfg, resolvedAcpAgent);
    if (agentPolicyError) {
      throw agentPolicyError;
    }
    if (hasInboundMediaForAcp(params.ctx) && !params.ctx.MediaUnderstanding?.length) {
      try {
        const { applyMediaUnderstanding } = await loadDispatchAcpMediaRuntime();
        await applyMediaUnderstanding({
          ctx: params.ctx,
          cfg: params.cfg,
        });
      } catch (err) {
        logVerbose(
          `dispatch-acp: media understanding failed, proceeding with raw content: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const promptText = resolveAcpPromptText(params.ctx);
    const attachments = await resolveAcpAttachments(params.ctx, params.cfg);
    if (!promptText && attachments.length === 0) {
      const counts = params.dispatcher.getQueuedCounts();
      delivery.applyRoutedCounts(counts);
      params.recordProcessed("completed", { reason: "acp_empty_prompt" });
      params.markIdle("message_completed");
      return { queuedFinal: false, counts };
    }

    try {
      await delivery.startReplyLifecycle();
    } catch (error) {
      logVerbose(
        `dispatch-acp: start reply lifecycle failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Guard against stalled upstream streams: abort the turn after the configured
    // agent timeout (agents.defaults.timeoutSeconds, default 600s). Without this,
    // a silently hung SSE connection blocks the session queue forever. refs #17258
    //
    // P2 (rev): Re-resolve session state immediately before runTurn so the wrapper
    // timeout reflects the most current runtimeOptions — not the stale snapshot
    // captured at the top of tryDispatchAcpReply (before media work and before
    // runTurn acquires the session actor). If the session was updated in that window,
    // this ensures dispatch and AcpSessionManager.runTurn share the same budget.
    const liveAcpMeta = readAcpSessionEntry({ cfg: params.cfg, sessionKey })?.acp ?? undefined;
    const liveTimeoutSeconds = liveAcpMeta
      ? resolveRuntimeOptionsFromMeta(liveAcpMeta).timeoutSeconds
      : undefined;
    const turnTimeoutMs =
      typeof liveTimeoutSeconds === "number" &&
      Number.isFinite(liveTimeoutSeconds) &&
      liveTimeoutSeconds > 0
        ? Math.max(30_000, Math.round(liveTimeoutSeconds * 1_000))
        : resolveAgentTimeoutMs({ cfg: params.cfg, minMs: 30_000 });

    // P1b: Track the runTurn promise so that when the dispatch-level timeout fires
    // we can wait for runTurn to settle before surfacing the error. Without this,
    // withTimeout() returns while runTurn drains in the background, causing late
    // events and keeping the session actor queue locked.
    const DRAIN_GRACE_MS = 5_000;
    let runTurnSettlePromise: Promise<void> | undefined;
    await withTimeout(
      (timeoutSignal) => {
        // P1a: Combine the caller's upstream abort signal with the timeout signal
        // so that either cancellation path (caller abort OR dispatch timeout)
        // reaches runTurn. Previously only the timeout signal was forwarded,
        // dropping params.abortSignal entirely.
        const signal =
          params.abortSignal != null && typeof AbortSignal.any === "function"
            ? AbortSignal.any([timeoutSignal!, params.abortSignal])
            : timeoutSignal;
        runTurnSettlePromise = acpManager.runTurn({
          cfg: params.cfg,
          sessionKey: canonicalSessionKey,
          text: promptText,
          attachments: attachments.length > 0 ? attachments : undefined,
          mode: "prompt",
          requestId: resolveAcpRequestId(params.ctx),
          onEvent: (event) => projector.onEvent(event),
          signal,
        });
        return runTurnSettlePromise;
      },
      turnTimeoutMs,
      "ACP turn",
    ).catch(async (err: unknown) => {
      // P1b: On timeout (or upstream abort), wait for runTurn to drain before
      // re-throwing. runTurn's own internal cleanup (cleanupTimedOutTurn) will
      // abort and close the runtime, but we need to wait for that to finish
      // so the session actor queue is fully released before we hand back control.
      if (runTurnSettlePromise !== undefined) {
        await Promise.race([
          runTurnSettlePromise.catch(() => {
            /* runTurn's own error is irrelevant here — we already have err */
          }),
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, DRAIN_GRACE_MS);
            (t as NodeJS.Timeout).unref?.();
          }),
        ]);
      }
      throw err;
    });

    await projector.flush(true);
    queuedFinal =
      (await finalizeAcpTurnOutput({
        cfg: params.cfg,
        sessionKey: canonicalSessionKey,
        delivery,
        inboundAudio: params.inboundAudio,
        sessionTtsAuto: params.sessionTtsAuto,
        ttsChannel: params.ttsChannel,
        shouldEmitResolvedIdentityNotice,
      })) || queuedFinal;

    const counts = params.dispatcher.getQueuedCounts();
    delivery.applyRoutedCounts(counts);
    const acpStats = acpManager.getObservabilitySnapshot(params.cfg);
    if (params.runId?.trim()) {
      emitAgentEvent({
        runId: params.runId.trim(),
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "end",
          startedAt: acpDispatchStartedAt,
          endedAt: Date.now(),
        },
      });
    }
    logVerbose(
      `acp-dispatch: session=${sessionKey} outcome=ok latencyMs=${Date.now() - acpDispatchStartedAt} queueDepth=${acpStats.turns.queueDepth} activeRuntimes=${acpStats.runtimeCache.activeSessions}`,
    );
    params.recordProcessed("completed", { reason: "acp_dispatch" });
    params.markIdle("message_completed");
    return { queuedFinal, counts };
  } catch (err) {
    await projector.flush(true);
    const acpError = toAcpRuntimeError({
      error: err,
      fallbackCode: "ACP_TURN_FAILED",
      fallbackMessage: "ACP turn failed before completion.",
    });
    await maybeUnbindStaleBoundConversations({
      targetSessionKey: canonicalSessionKey,
      error: acpError,
    });
    const delivered = await delivery.deliver("final", {
      text: formatAcpRuntimeErrorText(acpError),
      isError: true,
    });
    queuedFinal = queuedFinal || delivered;
    const counts = params.dispatcher.getQueuedCounts();
    delivery.applyRoutedCounts(counts);
    const acpStats = acpManager.getObservabilitySnapshot(params.cfg);
    if (params.runId?.trim()) {
      emitAgentEvent({
        runId: params.runId.trim(),
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "error",
          startedAt: acpDispatchStartedAt,
          endedAt: Date.now(),
          error: acpError.message,
        },
      });
    }
    logVerbose(
      `acp-dispatch: session=${sessionKey} outcome=error code=${acpError.code} latencyMs=${Date.now() - acpDispatchStartedAt} queueDepth=${acpStats.turns.queueDepth} activeRuntimes=${acpStats.runtimeCache.activeSessions}`,
    );
    params.recordProcessed("completed", {
      reason: `acp_error:${acpError.code.toLowerCase()}`,
    });
    params.markIdle("message_completed");
    return { queuedFinal, counts };
  }
}
