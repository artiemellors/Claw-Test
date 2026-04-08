import fs from "node:fs";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { resolveModelAuthMode } from "../../agents/model-auth.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { queueEmbeddedPiMessage } from "../../agents/pi-embedded.js";
import { spawnSubagentDirect } from "../../agents/subagent-spawn.js";
import { hasNonzeroUsage } from "../../agents/usage.js";
import {
  resolveAgentIdFromSessionKey,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPath,
  type SessionEntry,
  type SessionPostCompactionDelegate,
  updateSessionStore,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import type { TypingMode } from "../../config/types.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { emitDiagnosticEvent, isDiagnosticsEnabled } from "../../infra/diagnostic-events.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { generateSecureUuid } from "../../infra/secure-random.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { CommandLaneClearedError, GatewayDrainingError } from "../../process/command-queue.js";
import { defaultRuntime } from "../../runtime.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { estimateUsageCost, resolveModelCostConfig } from "../../utils/usage-format.js";
import {
  addDelayedContinuationReservation,
  cancelPendingDelegates,
  clearDelayedContinuationReservations,
  consumeStagedPostCompactionDelegates,
  delayedContinuationReservationCount,
  highestDelayedContinuationReservationHop,
  takeDelayedContinuationReservation,
  setTaskFlowDelegatesEnabled,
  stagePostCompactionDelegate,
  consumePendingDelegates,
  pendingDelegateCount,
  stagedPostCompactionDelegateCount,
} from "../continuation-delegate-store.js";
import {
  buildFallbackClearedNotice,
  buildFallbackNotice,
  resolveFallbackTransition,
} from "../fallback-state.js";
import type { OriginatingChannelType, TemplateContext } from "../templating.js";
import { resolveResponseUsageMode, type VerboseLevel } from "../thinking.js";
import { SILENT_REPLY_TOKEN, stripContinuationSignal, type ContinuationSignal } from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { runAgentTurnWithFallback } from "./agent-runner-execution.js";
import {
  createShouldEmitToolOutput,
  createShouldEmitToolResult,
  finalizeWithFollowup,
  isAudioPayload,
  signalTypingIfNeeded,
} from "./agent-runner-helpers.js";
import { runMemoryFlushIfNeeded, runPreflightCompactionIfNeeded } from "./agent-runner-memory.js";
import { buildReplyPayloads } from "./agent-runner-payloads.js";
import {
  appendUnscheduledReminderNote,
  hasSessionRelatedCronJobs,
  hasUnbackedReminderCommitment,
} from "./agent-runner-reminder-guard.js";
import { appendUsageLine, formatResponseUsageLine } from "./agent-runner-usage-line.js";
import { createAudioAsVoiceBuffer, createBlockReplyPipeline } from "./block-reply-pipeline.js";
import { resolveEffectiveBlockStreamingConfig } from "./block-streaming.js";
import { checkContextPressure } from "./context-pressure.js";
import { resolveContinuationRuntimeConfig } from "./continuation-runtime.js";
import { createFollowupRunner } from "./followup-runner.js";
import { resolveOriginMessageProvider, resolveOriginMessageTo } from "./origin-routing.js";
import { readPostCompactionContext } from "./post-compaction-context.js";
import { resolveActiveRunQueueAction } from "./queue-policy.js";
import {
  enqueueFollowupRun,
  refreshQueuedFollowupSession,
  type FollowupRun,
  type QueueSettings,
} from "./queue.js";
import { createReplyMediaPathNormalizer } from "./reply-media-paths.js";
import {
  createReplyOperation,
  ReplyRunAlreadyActiveError,
  replyRunRegistry,
  type ReplyOperation,
} from "./reply-run-registry.js";
import { createReplyToModeFilterForChannel, resolveReplyToMode } from "./reply-threading.js";
import { incrementRunCompactionCount, persistRunSessionUsage } from "./session-run-accounting.js";
import { createTypingSignaler } from "./typing-mode.js";
import type { TypingController } from "./typing.js";

const BLOCK_REPLY_SEND_TIMEOUT_MS = 15_000;
const continuationGuardLog = createSubsystemLogger("continuation/guard");

// Track pending continuation timers so they can be cancelled when an external
// message arrives during the delay window (prevents ghost continuations).
// Each entry includes a generation counter to guard against same-tick races:
// the timer callback verifies its generation matches the current value before
// scheduling the wake. An external message bumps the generation, invalidating
// any in-flight callbacks without needing clearTimeout races.
const continuationGenerations = new Map<string, number>();

// Per-session delegate-pending flags.  Lives outside the system-event queue
// so it is NOT drained by buildQueuedSystemPrompt on intervening turns.
// Set by subagent-announce when a delegate is spawned; cleared when the
// delegate's completion is detected in get-reply-run.
const delegatePendingFlags = new Map<string, boolean>();

export function setDelegatePending(sessionKey: string): void {
  delegatePendingFlags.set(sessionKey, true);
}

export function hasDelegatePending(sessionKey: string): boolean {
  return delegatePendingFlags.get(sessionKey) === true;
}

export function clearDelegatePending(sessionKey: string): void {
  delegatePendingFlags.delete(sessionKey);
  // Bump the generation instead of deleting it — deleting enables
  // generation-reuse collision if the counter is later re-created
  // at the same value a stale timer holds. (#105)
  bumpContinuationGeneration(sessionKey);
}

function clearDelegatePendingIfNoDelayedReservations(sessionKey: string): void {
  if (delayedContinuationReservationCount(sessionKey) === 0) {
    clearDelegatePending(sessionKey);
  }
}

export function currentContinuationGeneration(sessionKey: string): number {
  return continuationGenerations.get(sessionKey) ?? 0;
}

export function bumpContinuationGeneration(sessionKey: string): number {
  const next = currentContinuationGeneration(sessionKey) + 1;
  continuationGenerations.set(sessionKey, next);
  return next;
}

function syncPendingPostCompactionDelegates(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  delegates: SessionPostCompactionDelegate[] | undefined;
}) {
  if (params.sessionEntry) {
    params.sessionEntry.pendingPostCompactionDelegates = params.delegates;
  }
  if (params.sessionStore?.[params.sessionKey]) {
    params.sessionStore[params.sessionKey] = {
      ...params.sessionStore[params.sessionKey],
      pendingPostCompactionDelegates: params.delegates,
    };
  }
}

function normalizePostCompactionDelegate(
  delegate: SessionPostCompactionDelegate,
): SessionPostCompactionDelegate {
  // Legacy delegates persisted before silent/wake fields existed. Post-compaction
  // mode is defined as silent-wake, so missing flags must preserve that contract.
  const legacySilentWake = delegate.silent == null && delegate.silentWake == null;
  const silentWake = legacySilentWake ? true : delegate.silentWake === true;
  const silent = legacySilentWake ? true : delegate.silent === true || silentWake;

  return {
    task: delegate.task,
    createdAt: delegate.createdAt,
    ...(delegate.silent != null || legacySilentWake ? { silent } : {}),
    ...(delegate.silentWake != null || legacySilentWake ? { silentWake } : {}),
  };
}

async function persistPendingPostCompactionDelegates(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  storePath?: string;
  delegates: SessionPostCompactionDelegate[];
}): Promise<SessionPostCompactionDelegate[]> {
  if (params.delegates.length === 0) {
    return (params.sessionEntry?.pendingPostCompactionDelegates ?? []).map(
      normalizePostCompactionDelegate,
    );
  }

  const normalizedDelegates = params.delegates.map(normalizePostCompactionDelegate);
  const localExisting = (params.sessionEntry?.pendingPostCompactionDelegates ?? []).map(
    normalizePostCompactionDelegate,
  );
  const combinedLocal = [...localExisting, ...normalizedDelegates];

  if (!params.storePath) {
    syncPendingPostCompactionDelegates({
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      sessionKey: params.sessionKey,
      delegates: combinedLocal,
    });
    return combinedLocal;
  }

  const persisted = await updateSessionStore(params.storePath, (store) => {
    const current =
      store[params.sessionKey] ??
      params.sessionStore?.[params.sessionKey] ??
      params.sessionEntry ??
      undefined;
    const combined = [
      ...(current?.pendingPostCompactionDelegates ?? []).map(normalizePostCompactionDelegate),
      ...normalizedDelegates,
    ];
    if (current) {
      store[params.sessionKey] = {
        ...current,
        pendingPostCompactionDelegates: combined,
      };
    }
    return combined;
  });

  syncPendingPostCompactionDelegates({
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    delegates: persisted.length > 0 ? persisted : combinedLocal,
  });
  return persisted.length > 0 ? persisted : combinedLocal;
}

async function takePendingPostCompactionDelegates(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  storePath?: string;
}): Promise<SessionPostCompactionDelegate[]> {
  const localDelegates = (params.sessionEntry?.pendingPostCompactionDelegates ?? []).map(
    normalizePostCompactionDelegate,
  );

  if (!params.storePath) {
    syncPendingPostCompactionDelegates({
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      sessionKey: params.sessionKey,
      delegates: undefined,
    });
    return localDelegates;
  }

  const persisted = await updateSessionStore(params.storePath, (store) => {
    const current =
      store[params.sessionKey] ??
      params.sessionStore?.[params.sessionKey] ??
      params.sessionEntry ??
      undefined;
    const delegates = (current?.pendingPostCompactionDelegates ?? []).map(
      normalizePostCompactionDelegate,
    );
    if (current && delegates.length > 0) {
      store[params.sessionKey] = {
        ...current,
        pendingPostCompactionDelegates: undefined,
      };
    }
    return delegates;
  });

  syncPendingPostCompactionDelegates({
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    delegates: undefined,
  });
  return persisted.length > 0 ? persisted : localDelegates;
}

function buildPostCompactionLifecycleEvent(params: {
  compactionCount?: number;
  releasedDelegates: number;
  droppedDelegates: number;
}): string {
  const parts = [
    `[system:post-compaction] Session compacted at ${new Date().toISOString()}.`,
    typeof params.compactionCount === "number"
      ? `Compaction count: ${params.compactionCount}.`
      : undefined,
    `Released ${params.releasedDelegates} post-compaction delegate(s) into the fresh session.`,
    params.droppedDelegates > 0
      ? `${params.droppedDelegates} delegate(s) were not released into the fresh session.`
      : undefined,
  ].filter(Boolean);
  return parts.join(" ");
}

// clearContinuationGeneration intentionally removed: clearing the map entry
// resets the counter to 0, creating a generation-reuse window where a new
// chain's value can collide with a stale in-flight timer. All paths now use
// bumpContinuationGeneration instead.

/**
 * Cancel any pending continuation timer for the given session AND reset
 * chain metadata. Call this from early-return paths (inline actions, slash
 * commands, directive replies) that bypass runReplyAgent but still represent
 * real user input that should preempt a running continuation chain.
 *
 * We only bump (not clear) generations to avoid reuse: if we cleared the map
 * entry, a subsequent chain could reuse a generation value that matches a
 * stale in-flight timer callback.
 */
export function cancelContinuationTimer(
  sessionKey: string,
  sessionCtx?: {
    sessionEntry?: SessionEntry;
    sessionStore?: Record<string, SessionEntry>;
    storePath?: string;
  },
): void {
  // Only bump when a generation exists — avoids unbounded map growth
  // from sessions that never use continuation.
  if (continuationGenerations.has(sessionKey)) {
    bumpContinuationGeneration(sessionKey);
  }

  clearDelayedContinuationReservations(sessionKey);

  // Reset chain metadata so stale counters don't block future chains.
  // Check both chain count and chain tokens — chain count may be on child shards
  // (via task prefix), but tokens accumulate on the parent session.
  const hasChainState =
    (sessionCtx?.sessionEntry?.continuationChainCount ?? 0) > 0 ||
    (sessionCtx?.sessionEntry?.continuationChainTokens ?? 0) > 0;
  if (sessionCtx?.sessionEntry && hasChainState) {
    sessionCtx.sessionEntry.continuationChainCount = 0;
    sessionCtx.sessionEntry.continuationChainStartedAt = undefined;
    sessionCtx.sessionEntry.continuationChainTokens = undefined;
  }
  const storeEntry = sessionCtx?.sessionStore?.[sessionKey];
  const storeHasChainState =
    (storeEntry?.continuationChainCount ?? 0) > 0 || (storeEntry?.continuationChainTokens ?? 0) > 0;
  if (storeEntry && storeHasChainState && sessionCtx.sessionStore) {
    sessionCtx.sessionStore[sessionKey] = {
      ...storeEntry,
      continuationChainCount: 0,
      continuationChainStartedAt: undefined,
      continuationChainTokens: undefined,
    };
  }
  if (sessionCtx?.storePath) {
    void updateSessionStore(sessionCtx.storePath, (store) => {
      const entry = store[sessionKey];
      const entryHasChainState =
        (entry?.continuationChainCount ?? 0) > 0 || (entry?.continuationChainTokens ?? 0) > 0;
      if (entry && entryHasChainState) {
        entry.continuationChainCount = 0;
        entry.continuationChainStartedAt = undefined;
        entry.continuationChainTokens = undefined;
      }
    }).catch(() => {
      // Best-effort — chain state will be reset on next runReplyAgent entry.
    });
  }

  // Cancel any Task Flow-backed pending delegates that may have survived a
  // restart. For the volatile store this drains the Map as a safety net.
  cancelPendingDelegates(sessionKey);

  // Clear delegate-pending flag — no delegate should be considered in-flight
  // after explicit cancellation.
  clearDelegatePending(sessionKey);
}

export async function runReplyAgent(params: {
  commandBody: string;
  followupRun: FollowupRun;
  queueKey: string;
  resolvedQueue: QueueSettings;
  shouldSteer: boolean;
  shouldFollowup: boolean;
  isActive: boolean;
  isRunActive?: () => boolean;
  isStreaming: boolean;
  opts?: GetReplyOptions;
  typing: TypingController;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  defaultModel: string;
  agentCfgContextTokens?: number;
  resolvedVerboseLevel: VerboseLevel;
  isNewSession: boolean;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  sessionCtx: TemplateContext;
  shouldInjectGroupIntro: boolean;
  typingMode: TypingMode;
  /** True when this turn was triggered by a continuation timer (detected before system events are drained). */
  isContinuationWake?: boolean;
  resetTriggered?: boolean;
  replyOperation?: ReplyOperation;
}): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const {
    commandBody,
    followupRun,
    queueKey,
    resolvedQueue,
    shouldSteer,
    shouldFollowup,
    isActive,
    isRunActive,
    isStreaming,
    opts,
    typing,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
    resolvedVerboseLevel,
    isNewSession,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    sessionCtx,
    shouldInjectGroupIntro,
    typingMode,
    isContinuationWake,
    resetTriggered,
    replyOperation: providedReplyOperation,
  } = params;

  let activeSessionEntry = sessionEntry;
  const activeSessionStore = sessionStore;
  let activeIsNewSession = isNewSession;

  const isHeartbeat = opts?.isHeartbeat === true;
  const cfg = followupRun.run.config;
  const continuationFeatureEnabled = cfg?.agents?.defaults?.continuation?.enabled === true;
  const taskFlowDelegatesConfigured =
    cfg?.agents?.defaults?.continuation?.taskFlowDelegates !== false;

  // Route delegate store operations to the Task Flow-backed implementation
  // before any inbound-message cancellation logic runs.
  setTaskFlowDelegatesEnabled(continuationFeatureEnabled && taskFlowDelegatesConfigured);

  // Detect whether this turn is a continuation wake or an external message.
  // The isContinuationWake flag is set by the caller (get-reply-run) by peeking
  // system events BEFORE they are drained by buildQueuedSystemPrompt. This avoids
  // the race where draining empties the queue before we can check it here.
  const isContinuationEvent = isContinuationWake === true;

  if (!isContinuationEvent && !isHeartbeat && sessionKey) {
    // External (non-heartbeat) message — reset chain tracking and cancel timers.
    // Regular heartbeats (including periodic polls) must NOT preempt pending
    // continuation timers; only real user/external messages should.
    const hadActiveChain = (activeSessionEntry?.continuationChainCount ?? 0) > 0;
    const hadStaleTokens =
      !hadActiveChain &&
      typeof activeSessionEntry?.continuationChainTokens === "number" &&
      activeSessionEntry.continuationChainTokens > 0;
    const hadDelayedReservations = delayedContinuationReservationCount(sessionKey) > 0;
    if (activeSessionEntry && (hadActiveChain || hadStaleTokens)) {
      activeSessionEntry.continuationChainCount = 0;
      activeSessionEntry.continuationChainStartedAt = undefined;
      activeSessionEntry.continuationChainTokens = undefined;
    }
    // Every inbound user message on a continuation-enabled session must advance
    // the generation so in-flight guards observe the new turn, even when the
    // session had not armed a timer or created state yet.
    if (continuationFeatureEnabled) {
      bumpContinuationGeneration(sessionKey);
    }
    clearDelayedContinuationReservations(sessionKey);
    // Task Flow-backed delegates can survive restarts even after volatile
    // delayed reservations are gone, so external input must cancel them on
    // the first post-restart turn. The volatile store remains turn-local.
    if (hadDelayedReservations || taskFlowDelegatesConfigured) {
      cancelPendingDelegates(sessionKey);
      clearDelegatePending(sessionKey);
    }
    if ((hadActiveChain || hadStaleTokens) && activeSessionStore && activeSessionEntry) {
      activeSessionStore[sessionKey] = {
        ...activeSessionEntry,
        continuationChainCount: 0,
        continuationChainStartedAt: undefined,
        continuationChainTokens: undefined,
      };
    }
    // Persist reset to disk only when a chain was actually active — avoids
    // unnecessary lock + disk write on every normal message.
    if ((hadActiveChain || hadStaleTokens) && storePath) {
      try {
        await updateSessionStore(storePath, (store) => {
          const entry = store[sessionKey];
          if (entry) {
            entry.continuationChainCount = 0;
            entry.continuationChainStartedAt = undefined;
            entry.continuationChainTokens = undefined;
          }
        });
      } catch (err) {
        defaultRuntime.log(
          `Failed to persist continuation chain reset for ${sessionKey}: ${String(err)}`,
        );
      }
    }
  }

  const typingSignals = createTypingSignaler({
    typing,
    mode: typingMode,
    isHeartbeat,
  });

  const shouldEmitToolResult = createShouldEmitToolResult({
    sessionKey,
    storePath,
    resolvedVerboseLevel,
  });
  const shouldEmitToolOutput = createShouldEmitToolOutput({
    sessionKey,
    storePath,
    resolvedVerboseLevel,
  });

  const pendingToolTasks = new Set<Promise<void>>();
  const blockReplyTimeoutMs = opts?.blockReplyTimeoutMs ?? BLOCK_REPLY_SEND_TIMEOUT_MS;

  const replyToChannel = resolveOriginMessageProvider({
    originatingChannel: sessionCtx.OriginatingChannel,
    provider: sessionCtx.Surface ?? sessionCtx.Provider,
  }) as OriginatingChannelType | undefined;
  const replyToMode = resolveReplyToMode(
    followupRun.run.config,
    replyToChannel,
    sessionCtx.AccountId,
    sessionCtx.ChatType,
  );
  const applyReplyToMode = createReplyToModeFilterForChannel(replyToMode, replyToChannel);
  const normalizeReplyMediaPaths = createReplyMediaPathNormalizer({
    cfg,
    sessionKey,
    workspaceDir: followupRun.run.workspaceDir,
  });
  const blockReplyCoalescing =
    blockStreamingEnabled && opts?.onBlockReply
      ? resolveEffectiveBlockStreamingConfig({
          cfg,
          provider: sessionCtx.Provider,
          accountId: sessionCtx.AccountId,
          chunking: blockReplyChunking,
        }).coalescing
      : undefined;
  const blockReplyPipeline =
    blockStreamingEnabled && opts?.onBlockReply
      ? createBlockReplyPipeline({
          onBlockReply: opts.onBlockReply,
          timeoutMs: blockReplyTimeoutMs,
          coalescing: blockReplyCoalescing,
          buffer: createAudioAsVoiceBuffer({ isAudioPayload }),
        })
      : null;
  const touchActiveSessionEntry = async () => {
    if (!activeSessionEntry || !activeSessionStore || !sessionKey) {
      return;
    }
    const updatedAt = Date.now();
    activeSessionEntry.updatedAt = updatedAt;
    activeSessionStore[sessionKey] = activeSessionEntry;
    if (storePath) {
      try {
        await updateSessionStoreEntry({
          storePath,
          sessionKey,
          update: async () => ({ updatedAt }),
        });
      } catch (err) {
        defaultRuntime.log(`Failed to persist session touch for ${sessionKey}: ${String(err)}`);
      }
    }
  };

  if (shouldSteer && isStreaming) {
    const steerSessionId =
      (sessionKey ? replyRunRegistry.resolveSessionId(sessionKey) : undefined) ??
      followupRun.run.sessionId;
    const steered = queueEmbeddedPiMessage(steerSessionId, followupRun.prompt);
    if (steered && !shouldFollowup) {
      await touchActiveSessionEntry();
      typing.cleanup();
      return undefined;
    }
  }

  const activeRunQueueAction = resolveActiveRunQueueAction({
    isActive,
    isHeartbeat,
    shouldFollowup,
    queueMode: resolvedQueue.mode,
  });

  const queuedRunFollowupTurn = createFollowupRunner({
    opts,
    typing,
    typingMode,
    sessionEntry: activeSessionEntry,
    sessionStore: activeSessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
  });

  if (activeRunQueueAction === "drop") {
    typing.cleanup();
    return undefined;
  }

  if (activeRunQueueAction === "enqueue-followup") {
    enqueueFollowupRun(
      queueKey,
      followupRun,
      resolvedQueue,
      "message-id",
      queuedRunFollowupTurn,
      false,
    );
    // Re-check liveness after enqueue so a stale active snapshot cannot leave
    // the followup queue idle if the original run already finished.
    if (!isRunActive?.()) {
      finalizeWithFollowup(undefined, queueKey, queuedRunFollowupTurn);
    }
    await touchActiveSessionEntry();
    typing.cleanup();
    return undefined;
  }

  const replySessionKey = sessionKey ?? followupRun.run.sessionKey;
  let replyOperation: ReplyOperation;
  try {
    replyOperation =
      providedReplyOperation ??
      createReplyOperation({
        sessionId: followupRun.run.sessionId,
        sessionKey: replySessionKey ?? "",
        resetTriggered: resetTriggered === true,
        upstreamAbortSignal: opts?.abortSignal,
      });
  } catch (error) {
    if (error instanceof ReplyRunAlreadyActiveError) {
      typing.cleanup();
      return {
        text: "⚠️ Previous run is still shutting down. Please try again in a moment.",
      };
    }
    throw error;
  }
  let runFollowupTurn = queuedRunFollowupTurn;

  const postCompactionDelegatesToPreserve: SessionPostCompactionDelegate[] = [];

  const persistContinuationChainState = async (params: {
    count: number;
    startedAt: number;
    tokens: number;
  }): Promise<void> => {
    if (!sessionKey) {
      return;
    }
    if (activeSessionEntry) {
      activeSessionEntry.continuationChainCount = params.count;
      activeSessionEntry.continuationChainStartedAt = params.startedAt;
      activeSessionEntry.continuationChainTokens = params.tokens;
    }
    if (activeSessionStore) {
      const existingEntry = activeSessionStore[sessionKey] ?? activeSessionEntry;
      if (existingEntry) {
        activeSessionStore[sessionKey] = {
          ...existingEntry,
          continuationChainCount: params.count,
          continuationChainStartedAt: params.startedAt,
          continuationChainTokens: params.tokens,
        };
      }
    }
    if (storePath) {
      try {
        await updateSessionStore(storePath, (store) => {
          const entry = store[sessionKey];
          if (entry) {
            entry.continuationChainCount = params.count;
            entry.continuationChainStartedAt = params.startedAt;
            entry.continuationChainTokens = params.tokens;
          }
        });
      } catch (err) {
        defaultRuntime.log(
          `Failed to persist continuation chain state for ${sessionKey}: ${String(err)}`,
        );
      }
    }
  };
  try {
    await typingSignals.signalRunStart();

    activeSessionEntry = await runPreflightCompactionIfNeeded({
      cfg,
      followupRun,
      promptForEstimate: followupRun.prompt,
      defaultModel,
      agentCfgContextTokens,
      sessionEntry: activeSessionEntry,
      sessionStore: activeSessionStore,
      sessionKey,
      storePath,
      isHeartbeat,
      replyOperation,
    });

    activeSessionEntry = await runMemoryFlushIfNeeded({
      cfg,
      followupRun,
      promptForEstimate: followupRun.prompt,
      sessionCtx,
      opts,
      defaultModel,
      agentCfgContextTokens,
      resolvedVerboseLevel,
      sessionEntry: activeSessionEntry,
      sessionStore: activeSessionStore,
      sessionKey,
      storePath,
      isHeartbeat,
      replyOperation,
    });

    runFollowupTurn = createFollowupRunner({
      opts,
      typing,
      typingMode,
      sessionEntry: activeSessionEntry,
      sessionStore: activeSessionStore,
      sessionKey,
      storePath,
      defaultModel,
      agentCfgContextTokens,
    });

    let responseUsageLine: string | undefined;
    type SessionResetOptions = {
      failureLabel: string;
      buildLogMessage: (nextSessionId: string) => string;
      cleanupTranscripts?: boolean;
    };
    const resetSession = async ({
      failureLabel,
      buildLogMessage,
      cleanupTranscripts,
    }: SessionResetOptions): Promise<boolean> => {
      if (!sessionKey || !activeSessionStore || !storePath) {
        return false;
      }
      const prevEntry = activeSessionStore[sessionKey] ?? activeSessionEntry;
      if (!prevEntry) {
        return false;
      }
      const prevSessionId = cleanupTranscripts ? prevEntry.sessionId : undefined;
      const nextSessionId = generateSecureUuid();
      const nextEntry: SessionEntry = {
        ...prevEntry,
        sessionId: nextSessionId,
        updatedAt: Date.now(),
        systemSent: false,
        abortedLastRun: false,
        modelProvider: undefined,
        model: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        totalTokensFresh: false,
        estimatedCostUsd: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
        contextTokens: undefined,
        systemPromptReport: undefined,
        fallbackNoticeSelectedModel: undefined,
        fallbackNoticeActiveModel: undefined,
        fallbackNoticeReason: undefined,
        continuationChainCount: undefined,
        continuationChainStartedAt: undefined,
        continuationChainTokens: undefined,
      };
      const agentId = resolveAgentIdFromSessionKey(sessionKey);
      const nextSessionFile = resolveSessionTranscriptPath(
        nextSessionId,
        agentId,
        sessionCtx.MessageThreadId,
      );
      nextEntry.sessionFile = nextSessionFile;
      activeSessionStore[sessionKey] = nextEntry;
      try {
        await updateSessionStore(storePath, (store) => {
          store[sessionKey] = nextEntry;
        });
      } catch (err) {
        defaultRuntime.error(
          `Failed to persist session reset after ${failureLabel} (${sessionKey}): ${String(err)}`,
        );
      }
      followupRun.run.sessionId = nextSessionId;
      followupRun.run.sessionFile = nextSessionFile;
      refreshQueuedFollowupSession({
        key: queueKey,
        previousSessionId: prevEntry.sessionId,
        nextSessionId,
        nextSessionFile,
      });
      activeSessionEntry = nextEntry;
      activeIsNewSession = true;
      defaultRuntime.error(buildLogMessage(nextSessionId));
      if (cleanupTranscripts && prevSessionId) {
        const transcriptCandidates = new Set<string>();
        const resolved = resolveSessionFilePath(
          prevSessionId,
          prevEntry,
          resolveSessionFilePathOptions({ agentId, storePath }),
        );
        if (resolved) {
          transcriptCandidates.add(resolved);
        }
        transcriptCandidates.add(resolveSessionTranscriptPath(prevSessionId, agentId));
        for (const candidate of transcriptCandidates) {
          try {
            fs.unlinkSync(candidate);
          } catch {
            // Best-effort cleanup.
          }
        }
      }
      return true;
    };
    const resetSessionAfterCompactionFailure = async (reason: string): Promise<boolean> =>
      resetSession({
        failureLabel: "compaction failure",
        buildLogMessage: (nextSessionId) =>
          `Auto-compaction failed (${reason}). Restarting session ${sessionKey} -> ${nextSessionId} and retrying.`,
      });
    const resetSessionAfterRoleOrderingConflict = async (reason: string): Promise<boolean> =>
      resetSession({
        failureLabel: "role ordering conflict",
        buildLogMessage: (nextSessionId) =>
          `Role ordering conflict (${reason}). Restarting session ${sessionKey} -> ${nextSessionId}.`,
        cleanupTranscripts: true,
      });

    replyOperation.setPhase("running");

    // Trigger D: check context pressure before the agent turn and inject
    // a [system:context-pressure] event when a threshold band is crossed.
    if (activeSessionEntry && sessionKey) {
      const { contextPressureThreshold } = resolveContinuationRuntimeConfig(cfg);
      const contextWindowTokens =
        agentCfgContextTokens ??
        lookupContextTokens(defaultModel) ??
        activeSessionEntry.contextTokens ??
        DEFAULT_CONTEXT_TOKENS;
      const pressureResult = checkContextPressure({
        sessionEntry: activeSessionEntry,
        sessionKey,
        contextPressureThreshold,
        contextWindowTokens,
      });
      if (pressureResult.fired && storePath) {
        try {
          await updateSessionStore(storePath, (store) => {
            const entry = store[sessionKey];
            if (entry) {
              entry.lastContextPressureBand = pressureResult.band;
            }
          });
        } catch (err) {
          defaultRuntime.log(
            `context-pressure band persistence failed (non-fatal): ${String(err)}`,
          );
        }
      }
    }

    // Sync the Task Flow delegate gate BEFORE the agent turn starts.
    // Tools (continue_delegate) call enqueuePendingDelegate() during the turn,
    // so the routing flag must be set before any tool execution.
    const taskFlowDelegatesEarly =
      cfg.agents?.defaults?.continuation?.enabled === true &&
      cfg.agents?.defaults?.continuation?.taskFlowDelegates !== false;
    setTaskFlowDelegatesEnabled(taskFlowDelegatesEarly);

    const runStartedAt = Date.now();
    const runOutcome = await runAgentTurnWithFallback({
      commandBody,
      followupRun,
      sessionCtx,
      replyOperation,
      opts,
      typingSignals,
      blockReplyPipeline,
      blockStreamingEnabled,
      blockReplyChunking,
      resolvedBlockStreamingBreak,
      applyReplyToMode,
      shouldEmitToolResult,
      shouldEmitToolOutput,
      pendingToolTasks,
      resetSessionAfterCompactionFailure,
      resetSessionAfterRoleOrderingConflict,
      isHeartbeat,
      sessionKey,
      getActiveSessionEntry: () => activeSessionEntry,
      activeSessionStore,
      storePath,
      resolvedVerboseLevel,
    });

    if (runOutcome.kind === "final") {
      if (!replyOperation.result) {
        replyOperation.fail("run_failed", new Error("reply operation exited with final payload"));
      }
      return finalizeWithFollowup(runOutcome.payload, queueKey, runFollowupTurn);
    }

    const {
      runId,
      runResult,
      fallbackProvider,
      fallbackModel,
      fallbackAttempts,
      directlySentBlockKeys,
      continueWorkRequest,
    } = runOutcome;
    let { didLogHeartbeatStrip, autoCompactionCount } = runOutcome;

    if (
      shouldInjectGroupIntro &&
      activeSessionEntry &&
      activeSessionStore &&
      sessionKey &&
      activeSessionEntry.groupActivationNeedsSystemIntro
    ) {
      const updatedAt = Date.now();
      activeSessionEntry.groupActivationNeedsSystemIntro = false;
      activeSessionEntry.updatedAt = updatedAt;
      activeSessionStore[sessionKey] = activeSessionEntry;
      if (storePath) {
        try {
          await updateSessionStoreEntry({
            storePath,
            sessionKey,
            update: async () => ({
              groupActivationNeedsSystemIntro: false,
              updatedAt,
            }),
          });
        } catch (err) {
          defaultRuntime.log(
            `Failed to persist group activation intro state for ${sessionKey}: ${String(err)}`,
          );
        }
      }
    }

    const payloadArray = runResult.payloads ?? [];

    // Detect and strip continuation signal only when the feature is enabled.
    // This prevents output mutation on disabled deployments where a model might
    // mention CONTINUE_WORK or [[CONTINUE_DELEGATE:]] in explanatory text.
    // Sync the Task Flow delegate gate from config so the store routes
    // enqueue/consume/count through the TaskFlow-backed implementation.
    setTaskFlowDelegatesEnabled(
      continuationFeatureEnabled && cfg.agents?.defaults?.continuation?.taskFlowDelegates !== false,
    );
    let continuationSignal: ContinuationSignal | null = null;
    if (continuationFeatureEnabled && payloadArray.length > 0) {
      // Find the last payload with text content — tool-call payloads may follow
      // the text payload, pushing the bracket token out of the final position.
      // This is critical for subagent chain-hops where the bracket is the ONLY
      // continuation path (continue_delegate tool is denied for subagents).
      let lastTextPayload: (typeof payloadArray)[number] | undefined;
      for (let i = payloadArray.length - 1; i >= 0; i--) {
        if (payloadArray[i].text) {
          lastTextPayload = payloadArray[i];
          break;
        }
      }
      // [continuation:trace] Log what the backward scan sees for bracket diagnosis (#102 F4)
      const payloadSummary = payloadArray.map((p, i) => `[${i}]text=${!!p.text}${p.text ? `:"${p.text.slice(-60).replace(/\n/g, '\\n')}"` : ''}`).join(' ');
      continuationGuardLog.info(
        `[continuation:trace] payload-scan: count=${payloadArray.length} lastTextIdx=${lastTextPayload ? payloadArray.indexOf(lastTextPayload) : -1} ${payloadSummary} session=${sessionKey}`,
      );
      if (lastTextPayload?.text) {
        const continuationResult = stripContinuationSignal(lastTextPayload.text);
        if (continuationResult.signal) {
          continuationSignal = continuationResult.signal;
          lastTextPayload.text = continuationResult.text;
          continuationGuardLog.info(
            `[continuation:trace] bracket-parse: kind=${continuationResult.signal.kind} ` +
              `task=${continuationResult.signal.kind === "delegate" ? continuationResult.signal.task.slice(0, 80) : ""} delayMs=${continuationResult.signal.delayMs} ` +
              `silent=${continuationResult.signal.kind === "delegate" ? continuationResult.signal.silent : undefined} ` +
              `silentWake=${continuationResult.signal.kind === "delegate" ? continuationResult.signal.silentWake : undefined} ` +
              `payloads=${payloadArray.length} textPayloadIdx=${payloadArray.indexOf(lastTextPayload)} session=${sessionKey}`,
          );
        }
      }
    } else if (!continuationFeatureEnabled) {
      continuationGuardLog.info(
        `[continuation:trace] bracket-parse skipped: feature disabled session=${sessionKey}`,
      );
    } else if (payloadArray.length === 0) {
      continuationGuardLog.info(
        `[continuation:trace] bracket-parse skipped: empty payloadArray session=${sessionKey}`,
      );
    }
    // Reserve generation at parse time so external messages arriving during
    // the ~660-line gap before the scheduling block are visible as drift.
    const earlyDelegateGeneration =
      continuationSignal?.kind === "delegate" && sessionKey
        ? bumpContinuationGeneration(sessionKey)
        : null;
    const effectiveContinuationSignal: ContinuationSignal | null =
      continuationSignal ??
      (continuationFeatureEnabled && continueWorkRequest
        ? {
            kind: "work",
            delayMs: continueWorkRequest.delaySeconds * 1000,
          }
        : null);
    continuationGuardLog.info(
      `[continuation:trace] effective-signal: origin=${continuationSignal ? "bracket" : effectiveContinuationSignal ? "tool-call" : "none"} ` +
        `kind=${effectiveContinuationSignal?.kind ?? "none"} session=${sessionKey}`,
    );
    const continuationWorkReason =
      !continuationSignal && effectiveContinuationSignal?.kind === "work"
        ? continueWorkRequest?.reason
        : undefined;

    if (blockReplyPipeline) {
      await blockReplyPipeline.flush({ force: true });
      blockReplyPipeline.stop();
    }
    if (pendingToolTasks.size > 0) {
      await Promise.allSettled(pendingToolTasks);
    }

    const usage = runResult.meta?.agentMeta?.usage;
    const promptTokens = runResult.meta?.agentMeta?.promptTokens;
    const modelUsed = runResult.meta?.agentMeta?.model ?? fallbackModel ?? defaultModel;
    const providerUsed =
      runResult.meta?.agentMeta?.provider ?? fallbackProvider ?? followupRun.run.provider;
    const verboseEnabled = resolvedVerboseLevel !== "off";
    const selectedProvider = followupRun.run.provider;
    const selectedModel = followupRun.run.model;
    const fallbackStateEntry =
      activeSessionEntry ?? (sessionKey ? activeSessionStore?.[sessionKey] : undefined);
    const fallbackTransition = resolveFallbackTransition({
      selectedProvider,
      selectedModel,
      activeProvider: providerUsed,
      activeModel: modelUsed,
      attempts: fallbackAttempts,
      state: fallbackStateEntry,
    });
    if (fallbackTransition.stateChanged) {
      if (fallbackStateEntry) {
        fallbackStateEntry.fallbackNoticeSelectedModel = fallbackTransition.nextState.selectedModel;
        fallbackStateEntry.fallbackNoticeActiveModel = fallbackTransition.nextState.activeModel;
        fallbackStateEntry.fallbackNoticeReason = fallbackTransition.nextState.reason;
        fallbackStateEntry.updatedAt = Date.now();
        activeSessionEntry = fallbackStateEntry;
      }
      if (sessionKey && fallbackStateEntry && activeSessionStore) {
        activeSessionStore[sessionKey] = fallbackStateEntry;
      }
      if (sessionKey && storePath) {
        try {
          await updateSessionStoreEntry({
            storePath,
            sessionKey,
            update: async () => ({
              fallbackNoticeSelectedModel: fallbackTransition.nextState.selectedModel,
              fallbackNoticeActiveModel: fallbackTransition.nextState.activeModel,
              fallbackNoticeReason: fallbackTransition.nextState.reason,
            }),
          });
        } catch (err) {
          defaultRuntime.log(
            `Failed to persist fallback notice state for ${sessionKey}: ${String(err)}`,
          );
        }
      }
    }
    const cliSessionId = isCliProvider(providerUsed, cfg)
      ? normalizeOptionalString(runResult.meta?.agentMeta?.sessionId)
      : undefined;
    const cliSessionBinding = isCliProvider(providerUsed, cfg)
      ? runResult.meta?.agentMeta?.cliSessionBinding
      : undefined;
    const contextTokensUsed =
      agentCfgContextTokens ??
      lookupContextTokens(modelUsed) ??
      activeSessionEntry?.contextTokens ??
      DEFAULT_CONTEXT_TOKENS;

    await persistRunSessionUsage({
      storePath,
      sessionKey,
      cfg,
      usage,
      lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
      promptTokens,
      modelUsed,
      providerUsed,
      contextTokensUsed,
      systemPromptReport: runResult.meta?.systemPromptReport,
      cliSessionId,
      cliSessionBinding,
      usageIsContextSnapshot: isCliProvider(providerUsed, cfg),
    });

    const hasQueuedDelegateWork =
      continuationFeatureEnabled &&
      !!sessionKey &&
      (pendingDelegateCount(sessionKey) > 0 || stagedPostCompactionDelegateCount(sessionKey) > 0);

    // Drain any late tool/block deliveries before deciding there's "nothing to send".
    // Otherwise, a late typing trigger (e.g. from a tool callback) can outlive the run and
    // keep the typing indicator stuck. A tool-only continuation turn may have no visible
    // text while still needing delegate consumption/persistence below.
    if (payloadArray.length === 0 && !hasQueuedDelegateWork && !effectiveContinuationSignal) {
      return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
    }

    const payloadResult = await buildReplyPayloads({
      payloads: payloadArray,
      isHeartbeat,
      didLogHeartbeatStrip,
      silentExpected: followupRun.run.silentExpected,
      blockStreamingEnabled,
      blockReplyPipeline,
      directlySentBlockKeys,
      replyToMode,
      replyToChannel,
      currentMessageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,
      replyThreading: sessionCtx.ReplyThreading,
      messageProvider: followupRun.run.messageProvider,
      messagingToolSentTexts: runResult.messagingToolSentTexts,
      messagingToolSentMediaUrls: runResult.messagingToolSentMediaUrls,
      messagingToolSentTargets: runResult.messagingToolSentTargets,
      originatingChannel: sessionCtx.OriginatingChannel,
      originatingTo: resolveOriginMessageTo({
        originatingTo: sessionCtx.OriginatingTo,
        to: sessionCtx.To,
      }),
      accountId: sessionCtx.AccountId,
      normalizeMediaPaths: normalizeReplyMediaPaths,
    });
    const { replyPayloads } = payloadResult;
    didLogHeartbeatStrip = payloadResult.didLogHeartbeatStrip;

    // Track whether the agent reply was purely a continuation signal (stripped to empty).
    // Used later to suppress verbose/usage augmentation that would break silent continuation.
    const wasSilentContinuation = replyPayloads.length === 0 && !!effectiveContinuationSignal;

    if (replyPayloads.length === 0) {
      // If the agent replied with only a continuation signal (e.g. bare CONTINUE_WORK),
      // the signal was stripped and all payloads became empty. We still need to process
      // the continuation below. Tool-only delegate turns also pass through here.
      if (!effectiveContinuationSignal && !hasQueuedDelegateWork) {
        return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
      }
    }

    const successfulCronAdds = runResult.successfulCronAdds ?? 0;
    const hasReminderCommitment = replyPayloads.some(
      (payload) =>
        !payload.isError &&
        typeof payload.text === "string" &&
        hasUnbackedReminderCommitment(payload.text),
    );
    // Suppress the guard note when an existing cron job (created in a prior
    // turn) already covers the commitment — avoids false positives (#32228).
    const coveredByExistingCron =
      hasReminderCommitment && successfulCronAdds === 0
        ? await hasSessionRelatedCronJobs({
            cronStorePath: cfg.cron?.store,
            sessionKey,
          })
        : false;
    const guardedReplyPayloads =
      hasReminderCommitment && successfulCronAdds === 0 && !coveredByExistingCron
        ? appendUnscheduledReminderNote(replyPayloads)
        : replyPayloads;

    await signalTypingIfNeeded(guardedReplyPayloads, typingSignals);

    if (isDiagnosticsEnabled(cfg) && hasNonzeroUsage(usage)) {
      const input = usage.input ?? 0;
      const output = usage.output ?? 0;
      const cacheRead = usage.cacheRead ?? 0;
      const cacheWrite = usage.cacheWrite ?? 0;
      const promptTokens = input + cacheRead + cacheWrite;
      const totalTokens = usage.total ?? promptTokens + output;
      const costConfig = resolveModelCostConfig({
        provider: providerUsed,
        model: modelUsed,
        config: cfg,
      });
      const costUsd = estimateUsageCost({ usage, cost: costConfig });
      emitDiagnosticEvent({
        type: "model.usage",
        sessionKey,
        sessionId: followupRun.run.sessionId,
        channel: replyToChannel,
        provider: providerUsed,
        model: modelUsed,
        usage: {
          input,
          output,
          cacheRead,
          cacheWrite,
          promptTokens,
          total: totalTokens,
        },
        lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
        context: {
          limit: contextTokensUsed,
          used: totalTokens,
        },
        costUsd,
        durationMs: Date.now() - runStartedAt,
      });
    }

    const responseUsageRaw =
      activeSessionEntry?.responseUsage ??
      (sessionKey ? activeSessionStore?.[sessionKey]?.responseUsage : undefined);
    const responseUsageMode = resolveResponseUsageMode(responseUsageRaw);
    if (responseUsageMode !== "off" && hasNonzeroUsage(usage)) {
      const authMode = resolveModelAuthMode(providerUsed, cfg);
      const showCost = authMode === "api-key";
      const costConfig = showCost
        ? resolveModelCostConfig({
            provider: providerUsed,
            model: modelUsed,
            config: cfg,
          })
        : undefined;
      let formatted = formatResponseUsageLine({
        usage,
        showCost,
        costConfig,
      });
      if (formatted && responseUsageMode === "full" && sessionKey) {
        formatted = `${formatted} · session \`${sessionKey}\``;
      }
      if (formatted) {
        responseUsageLine = formatted;
      }
    }

    // If verbose is enabled, prepend operational run notices.
    let finalPayloads = guardedReplyPayloads;
    const verboseNotices: ReplyPayload[] = [];

    if (verboseEnabled && activeIsNewSession) {
      verboseNotices.push({ text: `🧭 New session: ${followupRun.run.sessionId}` });
    }

    if (fallbackTransition.fallbackTransitioned) {
      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "fallback",
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          reasonSummary: fallbackTransition.reasonSummary,
          attemptSummaries: fallbackTransition.attemptSummaries,
          attempts: fallbackAttempts,
        },
      });
      if (verboseEnabled) {
        const fallbackNotice = buildFallbackNotice({
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          attempts: fallbackAttempts,
        });
        if (fallbackNotice) {
          verboseNotices.push({ text: fallbackNotice });
        }
      }
    }
    if (fallbackTransition.fallbackCleared) {
      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "fallback_cleared",
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          previousActiveModel: fallbackTransition.previousState.activeModel,
        },
      });
      if (verboseEnabled) {
        verboseNotices.push({
          text: buildFallbackClearedNotice({
            selectedProvider,
            selectedModel,
            previousActiveModel: fallbackTransition.previousState.activeModel,
          }),
        });
      }
    }

    if (autoCompactionCount > 0) {
      const previousSessionId = activeSessionEntry?.sessionId ?? followupRun.run.sessionId;
      const count = await incrementRunCompactionCount({
        cfg,
        sessionEntry: activeSessionEntry,
        sessionStore: activeSessionStore,
        sessionKey,
        storePath,
        amount: autoCompactionCount,
        lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
        contextTokensUsed,
        newSessionId: runResult.meta?.agentMeta?.sessionId,
      });
      const refreshedSessionEntry =
        sessionKey && activeSessionStore ? activeSessionStore[sessionKey] : undefined;
      if (refreshedSessionEntry) {
        activeSessionEntry = refreshedSessionEntry;
        refreshQueuedFollowupSession({
          key: queueKey,
          previousSessionId,
          nextSessionId: refreshedSessionEntry.sessionId,
          nextSessionFile: refreshedSessionEntry.sessionFile,
        });
      }

      // Inject post-compaction workspace context for the next agent turn
      if (sessionKey) {
        const stagedCompactionDelegates = consumeStagedPostCompactionDelegates(sessionKey);
        let persistedCompactionDelegates: SessionPostCompactionDelegate[] = [];
        try {
          persistedCompactionDelegates = await takePendingPostCompactionDelegates({
            sessionEntry: activeSessionEntry,
            sessionStore: activeSessionStore,
            sessionKey,
            storePath,
          });
        } catch (err) {
          defaultRuntime.log(
            `Failed to load post-compaction delegates for ${sessionKey}: ${String(err)}`,
          );
        }
        const allCompactionDelegates = [
          ...persistedCompactionDelegates,
          ...stagedCompactionDelegates,
        ].map(normalizePostCompactionDelegate);
        const {
          maxChainLength: maxCompactionChainLength,
          maxDelegatesPerTurn: maxCompactionDelegates,
          costCapTokens: compactionCostCapTokens,
        } = resolveContinuationRuntimeConfig(cfg);
        // Account for bracket delegate spawned this turn so combined count
        // cannot exceed maxDelegatesPerTurn.
        const bracketDelegateOffset = continuationSignal?.kind === "delegate" ? 1 : 0;
        const compactionBudget = Math.max(0, maxCompactionDelegates - bracketDelegateOffset);
        const releasedCompactionDelegates = allCompactionDelegates.slice(0, compactionBudget);
        let droppedCompactionDelegates = Math.max(
          0,
          allCompactionDelegates.length - releasedCompactionDelegates.length,
        );
        const originalCompactionChainCount = activeSessionEntry?.continuationChainCount ?? 0;
        let currentCompactionChainCount = originalCompactionChainCount;
        const compactionChainStartedAt =
          activeSessionEntry?.continuationChainStartedAt ?? Date.now();
        const compactionChainTokens = activeSessionEntry?.continuationChainTokens ?? 0;
        let dispatchedCompactionDelegates = 0;

        const workspaceDir =
          typeof followupRun.run.workspaceDir === "string" && followupRun.run.workspaceDir.trim()
            ? followupRun.run.workspaceDir
            : resolveAgentWorkspaceDir(cfg, followupRun.run.agentId);
        readPostCompactionContext(workspaceDir, cfg)
          .then((contextContent) => {
            if (contextContent) {
              enqueueSystemEvent(contextContent, { sessionKey });
            }
          })
          .catch(() => {
            // Silent failure — post-compaction context is best-effort
          });

        // Dispatch compaction-triggered delegates (| post-compaction mode).
        for (const delegate of releasedCompactionDelegates) {
          if (currentCompactionChainCount >= maxCompactionChainLength) {
            droppedCompactionDelegates += 1;
            defaultRuntime.log(
              `Post-compaction delegate rejected: chain length ${currentCompactionChainCount} >= ${maxCompactionChainLength} for session ${sessionKey}`,
            );
            enqueueSystemEvent(
              `[continuation] Post-compaction delegate rejected: chain length ${maxCompactionChainLength} reached. Task: ${delegate.task}`,
              { sessionKey },
            );
            continue;
          }

          if (compactionCostCapTokens > 0 && compactionChainTokens > compactionCostCapTokens) {
            droppedCompactionDelegates += 1;
            defaultRuntime.log(
              `Post-compaction delegate rejected: cost cap exceeded (${compactionChainTokens} > ${compactionCostCapTokens}) for session ${sessionKey}`,
            );
            enqueueSystemEvent(
              `[continuation] Post-compaction delegate rejected: cost cap exceeded (${compactionChainTokens} > ${compactionCostCapTokens}). Task: ${delegate.task}`,
              { sessionKey },
            );
            continue;
          }

          const nextCompactionChainCount = currentCompactionChainCount + 1;
          defaultRuntime.log(
            `Post-compaction delegate dispatch for session ${sessionKey}: ${delegate.task}`,
          );
          try {
            const delegateWakeOnReturn = delegate.silentWake ?? true;
            const delegateSilentAnnounce = delegate.silent ?? delegateWakeOnReturn;
            const spawnResult = await spawnSubagentDirect(
              {
                task:
                  `[continuation:post-compaction] ` +
                  `[continuation:chain-hop:${nextCompactionChainCount}] ` +
                  `Compaction just completed. Carry this working state to the post-compaction session: ${delegate.task}`,
                ...(delegateSilentAnnounce ? { silentAnnounce: true } : {}),
                ...(delegateWakeOnReturn ? { silentAnnounce: true, wakeOnReturn: true } : {}),
                drainsContinuationDelegateQueue: true,
              },
              {
                agentSessionKey: sessionKey,
                agentChannel: followupRun.originatingChannel ?? undefined,
                agentAccountId: followupRun.originatingAccountId ?? undefined,
                agentTo: followupRun.originatingTo ?? undefined,
                agentThreadId: followupRun.originatingThreadId ?? undefined,
              },
            );
            if (spawnResult.status === "accepted") {
              currentCompactionChainCount = nextCompactionChainCount;
              dispatchedCompactionDelegates += 1;
              enqueueSystemEvent(
                `[continuation:compaction-delegate-spawned] Post-compaction shard dispatched: ${delegate.task}`,
                { sessionKey },
              );
            } else {
              droppedCompactionDelegates += 1;
              postCompactionDelegatesToPreserve.push(delegate);
              defaultRuntime.log(
                `Post-compaction delegate rejected (${spawnResult.status}) for session ${sessionKey} (re-staged)`,
              );
            }
          } catch (err) {
            droppedCompactionDelegates += 1;
            postCompactionDelegatesToPreserve.push(delegate);
            defaultRuntime.log(
              `Post-compaction delegate failed for session ${sessionKey} (re-staged): ${String(err)}`,
            );
          }
        }

        if (postCompactionDelegatesToPreserve.length > 0) {
          try {
            await persistPendingPostCompactionDelegates({
              sessionEntry: activeSessionEntry,
              sessionStore: activeSessionStore,
              sessionKey,
              storePath,
              delegates: postCompactionDelegatesToPreserve,
            });
            postCompactionDelegatesToPreserve.length = 0;
          } catch (err) {
            defaultRuntime.log(
              `Failed to persist re-staged post-compaction delegates for ${sessionKey} (${postCompactionDelegatesToPreserve.length}): ${String(err)}`,
            );
          }
        }

        enqueueSystemEvent(
          buildPostCompactionLifecycleEvent({
            compactionCount: count,
            releasedDelegates: dispatchedCompactionDelegates,
            droppedDelegates: droppedCompactionDelegates,
          }),
          { sessionKey },
        );

        if (currentCompactionChainCount > originalCompactionChainCount) {
          if (activeSessionEntry) {
            activeSessionEntry.continuationChainCount = currentCompactionChainCount;
            activeSessionEntry.continuationChainStartedAt = compactionChainStartedAt;
            activeSessionEntry.continuationChainTokens = compactionChainTokens;
          }
          if (activeSessionStore) {
            activeSessionStore[sessionKey] = {
              ...(activeSessionStore[sessionKey] ?? activeSessionEntry!),
              continuationChainCount: currentCompactionChainCount,
              continuationChainStartedAt: compactionChainStartedAt,
              continuationChainTokens: compactionChainTokens,
            };
          }
          if (storePath) {
            try {
              await updateSessionStore(storePath, (store) => {
                const entry = store[sessionKey];
                if (entry) {
                  entry.continuationChainCount = currentCompactionChainCount;
                  entry.continuationChainStartedAt = compactionChainStartedAt;
                  entry.continuationChainTokens = compactionChainTokens;
                }
              });
            } catch (err) {
              defaultRuntime.log(
                `Failed to persist post-compaction delegate chain state for ${sessionKey}: ${String(err)}`,
              );
            }
          }
        }
      }

      if (verboseEnabled) {
        const suffix = typeof count === "number" ? ` (count ${count})` : "";
        verboseNotices.push({ text: `🧹 Auto-compaction complete${suffix}.` });
      }
    }
    // Skip verbose/usage augmentation for silent continuations — a bare CONTINUE_WORK
    // should produce no user-visible output, not a usage line or verbose notice.
    if (!wasSilentContinuation) {
      if (verboseNotices.length > 0) {
        finalPayloads = [...verboseNotices, ...finalPayloads];
      }
      if (responseUsageLine) {
        finalPayloads = appendUsageLine(finalPayloads, responseUsageLine);
      }
    }

    // Handle continuation signal (CONTINUE_WORK / CONTINUE_DELEGATE).
    // `effectiveContinuationSignal` is either the parsed bracket signal or the
    // structured continue_work tool request captured during the run.
    let bracketTokensAccumulated = false;
    if (effectiveContinuationSignal && sessionKey) {
      const { maxChainLength, defaultDelayMs, minDelayMs, maxDelayMs, costCapTokens } =
        resolveContinuationRuntimeConfig(cfg);

      {
        // continuation scheduling block
        const currentChainCount = activeSessionEntry?.continuationChainCount ?? 0;
        const allocatedChainHop = Math.max(
          currentChainCount,
          highestDelayedContinuationReservationHop(sessionKey),
        );

        if (allocatedChainHop >= maxChainLength) {
          defaultRuntime.log(
            `Continuation chain capped at ${maxChainLength} for session ${sessionKey}`,
          );
          // Bump (not clear) to invalidate stale timers without reuse risk.
          // Clearing would reset to 0, letting a new chain's generation collide
          // with a stale in-flight timer's captured value.
          bumpContinuationGeneration(sessionKey);
        } else {
          // Accumulate token usage for cost cap (input + output only, excludes
          // cache reads/writes which inflate with inherited system prompt context).
          const usage = runResult.meta?.agentMeta?.usage;
          const turnTokens = (usage?.input ?? 0) + (usage?.output ?? 0);
          const previousChainTokens = activeSessionEntry?.continuationChainTokens ?? 0;
          const accumulatedChainTokens = previousChainTokens + turnTokens;
          bracketTokensAccumulated = true;

          if (costCapTokens > 0 && accumulatedChainTokens > costCapTokens) {
            defaultRuntime.log(
              `Continuation cost cap exceeded (${accumulatedChainTokens} > ${costCapTokens}) for session ${sessionKey}`,
            );
            bumpContinuationGeneration(sessionKey);
          } else {
            const nextChainCount = allocatedChainHop + 1;
            const chainStartedAt = activeSessionEntry?.continuationChainStartedAt ?? Date.now();
            if (effectiveContinuationSignal.kind === "delegate") {
              const delegateTask = effectiveContinuationSignal.task;
              const delegateDelayMs = effectiveContinuationSignal.delayMs;
              continuationGuardLog.info(
                `[continuation:trace] delegate-schedule: generation=${currentContinuationGeneration(sessionKey)} ` +
                  `hop=${nextChainCount}/${maxChainLength} delayMs=${delegateDelayMs} ` +
                  `origin=${continuationSignal ? "bracket" : "tool-call"} session=${sessionKey}`,
              );

              const doSpawn = async (
                plannedHop: number,
                task: string,
                options?: {
                  timerTriggered?: boolean;
                  silent?: boolean;
                  silentWake?: boolean;
                  startedAt?: number;
                },
              ) => {
                continuationGuardLog.info(
                  `[continuation:trace] doSpawn: hop=${plannedHop}/${maxChainLength} ` +
                    `timerTriggered=${options?.timerTriggered ?? false} silent=${options?.silent ?? false} ` +
                    `silentWake=${options?.silentWake ?? false} session=${sessionKey}`,
                );
                try {
                  const spawnResult = await spawnSubagentDirect(
                    {
                      // The spawned child carries its current chain position in-band.
                      // Announce-side chain hops parse this prefix as the canonical hop source.
                      task: `[continuation:chain-hop:${plannedHop}] Delegated task (turn ${plannedHop}/${maxChainLength}): ${task}`,
                      ...(options?.silent ? { silentAnnounce: true } : {}),
                      ...(options?.silentWake ? { silentAnnounce: true, wakeOnReturn: true } : {}),
                      drainsContinuationDelegateQueue: true,
                    },
                    {
                      agentSessionKey: sessionKey,
                      agentChannel: followupRun.originatingChannel ?? undefined,
                      agentAccountId: followupRun.originatingAccountId ?? undefined,
                      agentTo: followupRun.originatingTo ?? undefined,
                      agentThreadId: followupRun.originatingThreadId ?? undefined,
                    },
                  );
                  if (spawnResult.status === "accepted") {
                    if (options?.timerTriggered) {
                      defaultRuntime.log(
                        `DELEGATE timer fired and spawned turn ${plannedHop}/${maxChainLength} for session ${sessionKey}: ${task}`,
                      );
                    }
                    await persistContinuationChainState({
                      count: Math.max(activeSessionEntry?.continuationChainCount ?? 0, plannedHop),
                      startedAt: options?.startedAt ?? chainStartedAt,
                      tokens: Math.max(
                        accumulatedChainTokens,
                        activeSessionEntry?.continuationChainTokens ?? 0,
                      ),
                    });
                    enqueueSystemEvent(
                      `[continuation:delegate-spawned] Spawned turn ${plannedHop}/${maxChainLength}: ${task}`,
                      { sessionKey },
                    );
                    return true;
                  } else {
                    defaultRuntime.log(
                      `DELEGATE spawn rejected (${spawnResult.status}) for session ${sessionKey}`,
                    );
                    enqueueSystemEvent(
                      `[continuation] DELEGATE spawn ${spawnResult.status}: delegation was not accepted. Use sessions_spawn manually. Original task: ${task}`,
                      { sessionKey },
                    );
                    clearDelegatePendingIfNoDelayedReservations(sessionKey);
                    return false;
                  }
                } catch (err) {
                  clearDelegatePendingIfNoDelayedReservations(sessionKey);
                  defaultRuntime.log(
                    `DELEGATE spawn failed for session ${sessionKey}: ${String(err)}`,
                  );
                  enqueueSystemEvent(
                    `[continuation] DELEGATE spawn failed: ${String(err)}. Original task: ${task}`,
                    { sessionKey },
                  );
                  return false;
                }
              };

              // Mark delegate-pending via dedicated flag (not system event queue)
              // so it survives buildQueuedSystemPrompt draining on intervening turns.
              if (sessionKey) {
                setDelegatePending(sessionKey);
              }

              if (delegateDelayMs && delegateDelayMs > 0) {
                // Timed dispatch: spawn after delay. Timer does not survive
                // gateway restart — acceptable for v1 (see #176 for durable timers).
                const clampedDelay = Math.max(minDelayMs, Math.min(maxDelayMs, delegateDelayMs));
                // Generation guard: use the generation reserved at parse time so
                // external messages that arrived during the gap are visible as drift.
                const delegateGeneration = earlyDelegateGeneration ?? bumpContinuationGeneration(sessionKey);
                const reservationId = generateSecureUuid();
                addDelayedContinuationReservation(sessionKey, {
                  id: reservationId,
                  source: "bracket",
                  task: delegateTask,
                  createdAt: chainStartedAt,
                  fireAt: Date.now() + clampedDelay,
                  generation: delegateGeneration,
                  plannedHop: nextChainCount,
                  silent: effectiveContinuationSignal.silent,
                  silentWake: effectiveContinuationSignal.silentWake,
                });
                await persistContinuationChainState({
                  count: currentChainCount,
                  startedAt: chainStartedAt,
                  tokens: accumulatedChainTokens,
                });
                continuationGuardLog.debug(
                  `[continuation-guard] DELEGATE timer set: generation=${delegateGeneration} delayMs=${clampedDelay} session=${sessionKey}`,
                );
                setTimeout(() => {
                  const reservation = takeDelayedContinuationReservation(sessionKey, reservationId);
                  if (!reservation) {
                    return;
                  }
                  const { generationGuardTolerance } = resolveContinuationRuntimeConfig();
                  const currentGen = currentContinuationGeneration(sessionKey);
                  const drift = currentGen - reservation.generation;
                  continuationGuardLog.debug(
                    `[continuation-guard] DELEGATE timer check: stored=${reservation.generation} current=${currentGen} drift=${drift} tolerance=${generationGuardTolerance} session=${sessionKey}`,
                  );
                  if (drift > generationGuardTolerance) {
                    clearDelegatePendingIfNoDelayedReservations(sessionKey);
                    defaultRuntime.log(
                      `DELEGATE timer cancelled (generation drift ${drift} > tolerance ${generationGuardTolerance}) for session ${sessionKey}`,
                    );
                    return;
                  }
                  void doSpawn(reservation.plannedHop, reservation.task, {
                    timerTriggered: true,
                    silent: reservation.silent,
                    silentWake: reservation.silentWake,
                    startedAt: reservation.createdAt,
                  });
                }, clampedDelay).unref();
              } else {
                await doSpawn(nextChainCount, delegateTask, {
                  silent: effectiveContinuationSignal.silent,
                  silentWake: effectiveContinuationSignal.silentWake,
                  startedAt: chainStartedAt,
                });
              }
            } else {
              await persistContinuationChainState({
                count: nextChainCount,
                startedAt: chainStartedAt,
                tokens: accumulatedChainTokens,
              });
              // WORK: schedule a continuation turn after delay
              const requestedDelay = effectiveContinuationSignal.delayMs ?? defaultDelayMs;
              const clampedDelay = Math.max(minDelayMs, Math.min(maxDelayMs, requestedDelay));

              // Schedule continuation with the same live-read guard used for
              // delegate timers. In busy channels, generation drift reflects
              // generic session interruption, not just direct human preemption.
              const generation = bumpContinuationGeneration(sessionKey);
              continuationGuardLog.debug(
                `[continuation-guard] WORK timer set: generation=${generation} delayMs=${clampedDelay} session=${sessionKey}`,
              );
              setTimeout(() => {
                const { generationGuardTolerance } = resolveContinuationRuntimeConfig();
                const currentGen = currentContinuationGeneration(sessionKey);
                const drift = currentGen - generation;
                continuationGuardLog.debug(
                  `[continuation-guard] WORK timer check: stored=${generation} current=${currentGen} drift=${drift} tolerance=${generationGuardTolerance} session=${sessionKey}`,
                );
                if (drift > generationGuardTolerance) {
                  defaultRuntime.log(
                    `WORK timer cancelled (generation drift ${drift} > tolerance ${generationGuardTolerance}) for session ${sessionKey}`,
                  );
                  return;
                }
                defaultRuntime.log(`WORK timer fired for session ${sessionKey}`);
                enqueueSystemEvent(
                  `[continuation:wake] Turn ${nextChainCount}/${maxChainLength}. ` +
                    `Chain started at ${new Date(chainStartedAt).toISOString()}. ` +
                    `Accumulated tokens: ${accumulatedChainTokens}. ` +
                    `The agent elected to continue working.` +
                    (continuationWorkReason ? ` Reason: ${continuationWorkReason}` : ""),
                  { sessionKey },
                );
                requestHeartbeatNow({ sessionKey, reason: "continuation" });
              }, clampedDelay).unref();
            }
          }
        }
      }
    } else if (effectiveContinuationSignal && !sessionKey) {
      continuationGuardLog.info(
        `[continuation:trace] scheduling skipped: no sessionKey for signal kind=${effectiveContinuationSignal.kind}`,
      );
    }

    // Handle tool-dispatched continuation delegates (continue_delegate tool).
    // These are enqueued by the tool during execution and consumed here,
    // going through the same chain tracking as bracket-parsed signals.
    // Multiple delegates per turn are supported (multi-arrow fan-out).
    if (continuationFeatureEnabled && sessionKey) {
      const toolDelegates = consumePendingDelegates(sessionKey);
      if (toolDelegates.length > 0) {
        defaultRuntime.log(
          `[continue_delegate] Consuming ${toolDelegates.length} tool delegate(s) for session ${sessionKey}`,
        );
      }
      if (toolDelegates.length > 0) {
        const { maxChainLength, minDelayMs, maxDelayMs, costCapTokens, maxDelegatesPerTurn } =
          resolveContinuationRuntimeConfig(cfg);
        // If a bracket-signal delegate was already spawned this turn, count it
        // against the per-turn cap so mixed-signal turns cannot exceed the limit.
        const bracketDelegateCount = effectiveContinuationSignal?.kind === "delegate" ? 1 : 0;
        const remainingBudget = Math.max(0, maxDelegatesPerTurn - bracketDelegateCount);
        const delegatesWithinLimit = toolDelegates.slice(0, remainingBudget);
        const delegatesOverLimit = toolDelegates.slice(remainingBudget);
        for (const droppedDelegate of delegatesOverLimit) {
          enqueueSystemEvent(
            `[continuation] Tool delegate rejected: maxDelegatesPerTurn exceeded (${maxDelegatesPerTurn}). Task: ${droppedDelegate.task}`,
            { sessionKey },
          );
        }

        let currentChainCount = activeSessionEntry?.continuationChainCount ?? 0;
        // Accumulate current turn's token usage into chain cost.
        // Skip if the bracket-signal path already accumulated this turn's tokens
        // (both paths read from the same activeSessionEntry.continuationChainTokens).
        const bracketAlreadyAccumulated = bracketTokensAccumulated;
        const toolDelegateUsage = runResult.meta?.agentMeta?.usage;
        // Count only input + output tokens for cost cap (excludes cache reads/writes
        // which inflate the count with inherited system prompt context).
        const toolDelegateTurnTokens = bracketAlreadyAccumulated
          ? 0
          : (toolDelegateUsage?.input ?? 0) + (toolDelegateUsage?.output ?? 0);
        let accumulatedChainTokens =
          (activeSessionEntry?.continuationChainTokens ?? 0) + toolDelegateTurnTokens;
        const chainStartedAt = activeSessionEntry?.continuationChainStartedAt ?? Date.now();

        for (const delegate of delegatesWithinLimit) {
          const allocatedChainHop = Math.max(
            currentChainCount,
            highestDelayedContinuationReservationHop(sessionKey),
          );
          if (allocatedChainHop >= maxChainLength) {
            defaultRuntime.log(
              `Continuation chain capped at ${maxChainLength} for tool delegate in session ${sessionKey}`,
            );
            enqueueSystemEvent(
              `[continuation] Tool delegate rejected: chain length ${maxChainLength} reached. Task: ${delegate.task}`,
              { sessionKey },
            );
            break;
          }

          if (costCapTokens > 0 && accumulatedChainTokens > costCapTokens) {
            defaultRuntime.log(
              `Continuation cost cap exceeded for tool delegate in session ${sessionKey}`,
            );
            enqueueSystemEvent(
              `[continuation] Tool delegate rejected: cost cap exceeded (${accumulatedChainTokens} > ${costCapTokens}). Task: ${delegate.task}`,
              { sessionKey },
            );
            break;
          }

          const nextChainCount = allocatedChainHop + 1;

          const doToolSpawn = async (
            plannedHop: number,
            task: string,
            options?: {
              timerTriggered?: boolean;
              silent?: boolean;
              silentWake?: boolean;
              startedAt?: number;
            },
          ) => {
            try {
              const spawnResult = await spawnSubagentDirect(
                {
                  task: `[continuation:chain-hop:${plannedHop}] Delegated task (turn ${plannedHop}/${maxChainLength}): ${task}`,
                  ...(options?.silent ? { silentAnnounce: true } : {}),
                  ...(options?.silentWake ? { silentAnnounce: true, wakeOnReturn: true } : {}),
                  drainsContinuationDelegateQueue: true,
                },
                {
                  agentSessionKey: sessionKey,
                  agentChannel: followupRun.originatingChannel ?? undefined,
                  agentAccountId: followupRun.originatingAccountId ?? undefined,
                  agentTo: followupRun.originatingTo ?? undefined,
                  agentThreadId: followupRun.originatingThreadId ?? undefined,
                },
              );
              if (spawnResult.status === "accepted") {
                if (options?.timerTriggered) {
                  defaultRuntime.log(
                    `Tool DELEGATE timer fired and spawned turn ${plannedHop}/${maxChainLength} for session ${sessionKey}: ${task}`,
                  );
                }
                currentChainCount = Math.max(currentChainCount, plannedHop);
                await persistContinuationChainState({
                  count: currentChainCount,
                  startedAt: options?.startedAt ?? chainStartedAt,
                  tokens: Math.max(
                    accumulatedChainTokens,
                    activeSessionEntry?.continuationChainTokens ?? 0,
                  ),
                });
                enqueueSystemEvent(
                  `[continuation:delegate-spawned] Tool delegate turn ${plannedHop}/${maxChainLength}: ${task}`,
                  { sessionKey },
                );
                return true;
              } else {
                defaultRuntime.log(
                  `Tool DELEGATE spawn rejected (${spawnResult.status}) for session ${sessionKey}`,
                );
                enqueueSystemEvent(
                  `[continuation] Tool DELEGATE spawn ${spawnResult.status}: ${task}`,
                  { sessionKey },
                );
                clearDelegatePendingIfNoDelayedReservations(sessionKey);
                return false;
              }
            } catch (err) {
              clearDelegatePendingIfNoDelayedReservations(sessionKey);
              defaultRuntime.log(
                `Tool DELEGATE spawn failed for session ${sessionKey}: ${String(err)}`,
              );
              enqueueSystemEvent(
                `[continuation] Tool DELEGATE spawn failed: ${String(err)}. Task: ${task}`,
                { sessionKey },
              );
              return false;
            }
          };

          // Mark delegate-pending via dedicated flag (not system event queue)
          // so it survives buildQueuedSystemPrompt draining on intervening turns.
          if (sessionKey) {
            setDelegatePending(sessionKey);
          }

          if (delegate.delayMs && delegate.delayMs > 0) {
            const clampedDelay = Math.max(minDelayMs, Math.min(maxDelayMs, delegate.delayMs));
            // Generation guard: same as bracket-path delegate timers
            const toolDelegateGeneration = bumpContinuationGeneration(sessionKey);
            const reservationId = generateSecureUuid();
            addDelayedContinuationReservation(sessionKey, {
              id: reservationId,
              source: "tool",
              task: delegate.task,
              createdAt: chainStartedAt,
              fireAt: Date.now() + clampedDelay,
              generation: toolDelegateGeneration,
              plannedHop: nextChainCount,
              silent: delegate.silent,
              silentWake: delegate.silentWake,
            });
            await persistContinuationChainState({
              count: currentChainCount,
              startedAt: chainStartedAt,
              tokens: accumulatedChainTokens,
            });
            continuationGuardLog.debug(
              `[continuation-guard] Tool DELEGATE timer set: generation=${toolDelegateGeneration} delayMs=${clampedDelay} session=${sessionKey}`,
            );
            setTimeout(() => {
              const reservation = takeDelayedContinuationReservation(sessionKey, reservationId);
              if (!reservation) {
                return;
              }
              const { generationGuardTolerance } = resolveContinuationRuntimeConfig();
              const currentGen = currentContinuationGeneration(sessionKey);
              const drift = currentGen - reservation.generation;
              continuationGuardLog.debug(
                `[continuation-guard] Tool DELEGATE timer check: stored=${reservation.generation} current=${currentGen} drift=${drift} tolerance=${generationGuardTolerance} session=${sessionKey}`,
              );
              if (drift > generationGuardTolerance) {
                clearDelegatePendingIfNoDelayedReservations(sessionKey);
                defaultRuntime.log(
                  `Tool DELEGATE timer cancelled (generation drift ${drift} > tolerance ${generationGuardTolerance}) for session ${sessionKey}`,
                );
                return;
              }
              void doToolSpawn(reservation.plannedHop, reservation.task, {
                timerTriggered: true,
                silent: reservation.silent,
                silentWake: reservation.silentWake,
                startedAt: reservation.createdAt,
              });
            }, clampedDelay).unref();
          } else {
            await doToolSpawn(nextChainCount, delegate.task, {
              silent: delegate.silent,
              silentWake: delegate.silentWake,
              startedAt: chainStartedAt,
            });
          }
        }
      }
    }

    if (!autoCompactionCount && continuationFeatureEnabled && sessionKey) {
      const stagedCompactionDelegates = consumeStagedPostCompactionDelegates(sessionKey);
      if (stagedCompactionDelegates.length > 0) {
        try {
          await persistPendingPostCompactionDelegates({
            sessionEntry: activeSessionEntry,
            sessionStore: activeSessionStore,
            sessionKey,
            storePath,
            delegates: stagedCompactionDelegates,
          });
        } catch (err) {
          postCompactionDelegatesToPreserve.push(...stagedCompactionDelegates);
          defaultRuntime.log(
            `Failed to persist post-compaction delegates for ${sessionKey} (re-staged ${stagedCompactionDelegates.length}): ${String(err)}`,
          );
        }
      }
    }

    // Silent continuations should produce no user-visible output.
    if (wasSilentContinuation) {
      return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
    }

    return finalizeWithFollowup(
      finalPayloads.length === 1 ? finalPayloads[0] : finalPayloads,
      queueKey,
      runFollowupTurn,
    );
  } catch (error) {
    if (
      replyOperation.result?.kind === "aborted" &&
      replyOperation.result.code === "aborted_for_restart"
    ) {
      return finalizeWithFollowup(
        { text: "⚠️ Gateway is restarting. Please wait a few seconds and try again." },
        queueKey,
        runFollowupTurn,
      );
    }
    if (replyOperation.result?.kind === "aborted") {
      return finalizeWithFollowup({ text: SILENT_REPLY_TOKEN }, queueKey, runFollowupTurn);
    }
    if (error instanceof GatewayDrainingError) {
      replyOperation.fail("gateway_draining", error);
      return finalizeWithFollowup(
        { text: "⚠️ Gateway is restarting. Please wait a few seconds and try again." },
        queueKey,
        runFollowupTurn,
      );
    }
    if (error instanceof CommandLaneClearedError) {
      replyOperation.fail("command_lane_cleared", error);
      return finalizeWithFollowup(
        { text: "⚠️ Gateway is restarting. Please wait a few seconds and try again." },
        queueKey,
        runFollowupTurn,
      );
    }
    replyOperation.fail("run_failed", error);
    // Keep the followup queue moving even when an unexpected exception escapes
    // the run path; the caller still receives the original error.
    finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
    throw error;
  } finally {
    replyOperation.complete();
    blockReplyPipeline?.stop();
    typing.markRunComplete();
    // Drain any stale delegates from a failed turn — they must not leak
    // into the next successful turn for the same session.
    if (sessionKey) {
      consumePendingDelegates(sessionKey);
      consumeStagedPostCompactionDelegates(sessionKey);
      for (const delegate of postCompactionDelegatesToPreserve) {
        stagePostCompactionDelegate(sessionKey, delegate);
      }
    }
    // Safety net: the dispatcher's onIdle callback normally fires
    // markDispatchIdle(), but if the dispatcher exits early, errors,
    // or the reply path doesn't go through it cleanly, the second
    // signal never fires and the typing keepalive loop runs forever.
    // Calling this twice is harmless — cleanup() is guarded by the
    // `active` flag.  Same pattern as the followup runner fix (#26881).
    typing.markDispatchIdle();
  }
}
