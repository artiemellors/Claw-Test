import { consumePendingDelegates } from "../auto-reply/continuation-delegate-store.js";
import {
  bumpContinuationGeneration,
  currentContinuationGeneration,
  setDelegatePending,
} from "../auto-reply/reply/agent-runner.js";
import { resolveContinuationRuntimeConfig } from "../auto-reply/reply/continuation-runtime.js";
import {
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
  stripContinuationSignal,
} from "../auto-reply/tokens.js";
import { DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH } from "../config/agent-limits.js";
import {
  resolveAgentIdFromSessionKey,
  resolveStorePath,
  updateSessionStore,
} from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { defaultRuntime } from "../runtime.js";
import { isCronSessionKey } from "../sessions/session-key-utils.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { type DeliveryContext, normalizeDeliveryContext } from "../utils/delivery-context.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import {
  buildAnnounceIdFromChildRun,
  buildAnnounceIdempotencyKey,
} from "./announce-idempotency.js";
import { formatAgentInternalEventsForPrompt, type AgentInternalEvent } from "./internal-events.js";
import {
  deliverSubagentAnnouncement,
  loadRequesterSessionEntry,
  loadSessionEntryByKey,
  runAnnounceDeliveryWithRetry,
  resolveSubagentAnnounceTimeoutMs,
  resolveSubagentCompletionOrigin,
} from "./subagent-announce-delivery.js";
import { resolveAnnounceOrigin } from "./subagent-announce-origin.js";
import {
  applySubagentWaitOutcome,
  buildChildCompletionFindings,
  buildCompactAnnounceStatsLine,
  dedupeLatestChildCompletionRows,
  filterCurrentDirectChildCompletionRows,
  readLatestSubagentOutputWithRetry,
  readSubagentOutput,
  type SubagentRunOutcome,
  waitForSubagentRunOutcome,
} from "./subagent-announce-output.js";
import {
  callGateway,
  isEmbeddedPiRunActive,
  loadConfig,
  waitForEmbeddedPiRunEnd,
} from "./subagent-announce.runtime.js";
import { getSubagentDepthFromSessionStore } from "./subagent-depth.js";
import { spawnSubagentDirect, type SpawnSubagentMode } from "./subagent-spawn.js";
import { isAnnounceSkip } from "./tools/sessions-send-tokens.js";

type SubagentAnnounceDeps = {
  callGateway: typeof callGateway;
  loadConfig: typeof loadConfig;
};

const defaultSubagentAnnounceDeps: SubagentAnnounceDeps = {
  callGateway,
  loadConfig,
};

let subagentAnnounceDeps: SubagentAnnounceDeps = defaultSubagentAnnounceDeps;

let subagentRegistryRuntimePromise: Promise<
  typeof import("./subagent-announce.registry.runtime.js")
> | null = null;

function loadSubagentRegistryRuntime() {
  subagentRegistryRuntimePromise ??= import("./subagent-announce.registry.runtime.js");
  return subagentRegistryRuntimePromise;
}

const continuationGuardLog = createSubsystemLogger("continuation/guard");

export function buildSubagentSystemPrompt(params: {
  requesterSessionKey?: string;
  requesterOrigin?: DeliveryContext;
  childSessionKey: string;
  label?: string;
  task?: string;
  /** Whether ACP-specific routing guidance should be included. Defaults to true. */
  acpEnabled?: boolean;
  /** Depth of the child being spawned (1 = sub-agent, 2 = sub-sub-agent). */
  childDepth?: number;
  /** Config value: max allowed spawn depth. */
  maxSpawnDepth?: number;
  /** Tool names available to the child — used to teach tool-primary vs bracket-only continuation. */
  toolNames?: string[];
  /** Whether continuation chaining is enabled. Defaults to config value. */
  continuationEnabled?: boolean;
}) {
  const taskText =
    typeof params.task === "string" && params.task.trim()
      ? params.task.replace(/\s+/g, " ").trim()
      : "{{TASK_DESCRIPTION}}";
  const childDepth = typeof params.childDepth === "number" ? params.childDepth : 1;
  const maxSpawnDepth =
    typeof params.maxSpawnDepth === "number"
      ? params.maxSpawnDepth
      : DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH;
  const acpEnabled = params.acpEnabled !== false;
  const canSpawn = childDepth < maxSpawnDepth;
  const parentLabel = childDepth >= 2 ? "parent orchestrator" : "main agent";

  const lines = [
    "# Subagent Context",
    "",
    `You are a **subagent** spawned by the ${parentLabel} for a specific task.`,
    "",
    "## Your Role",
    `- You were created to handle: ${taskText}`,
    "- Complete this task. That's your entire purpose.",
    `- You are NOT the ${parentLabel}. Don't try to be.`,
    "",
    "## Rules",
    "1. **Stay focused** - Do your assigned task, nothing else",
    `2. **Complete the task** - Your final message will be automatically reported to the ${parentLabel}`,
    "3. **Don't initiate** - No heartbeats, no proactive actions, no side quests",
    "4. **Be ephemeral** - You may be terminated after task completion. That's fine.",
    "5. **Trust push-based completion** - Descendant results are auto-announced back to you; do not busy-poll for status.",
    "6. **Recover from truncated tool output** - If you see a notice like `[... N more characters truncated]`, assume prior output was reduced. Re-read only what you need using smaller chunks (`read` with offset/limit, or targeted `rg`/`head`/`tail`) instead of full-file `cat`.",
    "",
    "## Output Format",
    "When complete, your final response should include:",
    `- What you accomplished or found`,
    `- Any relevant details the ${parentLabel} should know`,
    "- Keep it concise but informative",
    "",
    "## What You DON'T Do",
    `- NO user conversations (that's ${parentLabel}'s job)`,
    "- NO external messages (email, tweets, etc.) unless explicitly tasked with a specific recipient/channel",
    "- NO cron jobs or persistent state",
    `- NO pretending to be the ${parentLabel}`,
    `- Only use the \`message\` tool when explicitly instructed to contact a specific external recipient; otherwise return plain text and let the ${parentLabel} deliver it`,
    "",
  ];

  if (canSpawn) {
    lines.push(
      "## Sub-Agent Spawning",
      "You CAN spawn your own sub-agents for parallel or complex work using `sessions_spawn`.",
      "Use the `subagents` tool to steer, kill, or do an on-demand status check for your spawned sub-agents.",
      "Your sub-agents will announce their results back to you automatically (not to the main agent).",
      "Default workflow: spawn work, continue orchestrating, and wait for auto-announced completions.",
      "Auto-announce is push-based. After spawning children, do NOT call sessions_list, sessions_history, exec sleep, or any polling tool.",
      "Wait for completion events to arrive as user messages.",
      "Track expected child session keys and only send your final answer after completion events for ALL expected children arrive.",
      "If a child completion event arrives AFTER you already sent your final answer, reply ONLY with NO_REPLY.",
      "Do NOT repeatedly poll `subagents list` in a loop unless you are actively debugging or intervening.",
      "Coordinate their work and synthesize results before reporting back.",
      ...(acpEnabled
        ? [
            'For ACP harness sessions (codex/claudecode/gemini), use `sessions_spawn` with `runtime: "acp"` (set `agentId` unless `acp.defaultAgent` is configured).',
            '`agents_list` and `subagents` apply to OpenClaw sub-agents (`runtime: "subagent"`); ACP harness ids are controlled by `acp.allowedAgents`.',
            "Do not ask users to run slash commands or CLI when `sessions_spawn` can do it directly.",
            "Do not use `exec` (`openclaw ...`, `acpx ...`) to spawn ACP sessions.",
            'Use `subagents` only for OpenClaw subagents (`runtime: "subagent"`).',
            "Subagent results auto-announce back to you; ACP sessions continue in their bound thread.",
            "Avoid polling loops; spawn, orchestrate, and synthesize results.",
          ]
        : []),
      "",
    );
  } else if (childDepth >= 2) {
    lines.push(
      "## Sub-Agent Spawning",
      "You are a leaf worker and CANNOT spawn further sub-agents. Focus on your assigned task.",
      "",
    );
  }

  lines.push(
    "## Session Context",
    ...[
      params.label ? `- Label: ${params.label}` : undefined,
      params.requesterSessionKey
        ? `- Requester session: ${params.requesterSessionKey}.`
        : undefined,
      params.requesterOrigin?.channel
        ? `- Requester channel: ${params.requesterOrigin.channel}.`
        : undefined,
      `- Your session: ${params.childSessionKey}.`,
    ].filter((line): line is string => line !== undefined),
    "",
  );
  return lines.join("\n");
}

export { captureSubagentCompletionReply } from "./subagent-announce-output.js";
export type { SubagentRunOutcome } from "./subagent-announce-output.js";

export type SubagentAnnounceType = "subagent task" | "cron job";

function buildAnnounceReplyInstruction(params: {
  requesterIsSubagent: boolean;
  announceType: SubagentAnnounceType;
  expectsCompletionMessage?: boolean;
  silentEnrichment?: boolean;
  silentWakeEnrichment?: boolean;
}): string {
  if (params.requesterIsSubagent) {
    return `Convert this completion into a concise internal orchestration update for your parent agent in your own words. Keep this internal context private (don't mention system/log/stats/session details or announce type). If this result is duplicate or no update is needed, reply ONLY: ${SILENT_REPLY_TOKEN}.`;
  }
  if (params.expectsCompletionMessage) {
    return `A completed ${params.announceType} is ready for user delivery. Convert the result above into your normal assistant voice and send that user-facing update now. Keep this internal context private (don't mention system/log/stats/session details or announce type).`;
  }
  return `A completed ${params.announceType} is ready for user delivery. Convert the result above into your normal assistant voice and send that user-facing update now. Keep this internal context private (don't mention system/log/stats/session details or announce type), and do not copy the internal event text verbatim. Reply ONLY: ${SILENT_REPLY_TOKEN} if this exact result was already delivered to the user in this same turn.`;
}

function buildAnnounceSteerMessage(events: AgentInternalEvent[]): string {
  return (
    formatAgentInternalEventsForPrompt(events) ||
    "A background task finished. Process the completion update now."
  );
}

function hasUsableSessionEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const sessionId = (entry as { sessionId?: unknown }).sessionId;
  return typeof sessionId !== "string" || sessionId.trim() !== "";
}

function buildDescendantWakeMessage(params: { findings: string; taskLabel: string }): string {
  return [
    "[Subagent Context] Your prior run ended while waiting for descendant subagent completions.",
    "[Subagent Context] All pending descendants for that run have now settled.",
    "[Subagent Context] Continue your workflow using these results. Spawn more subagents if needed, otherwise send your final answer.",
    "",
    `Task: ${params.taskLabel}`,
    "",
    params.findings,
  ].join("\n");
}

const WAKE_RUN_SUFFIX = ":wake";

function stripWakeRunSuffixes(runId: string): string {
  let next = runId.trim();
  while (next.endsWith(WAKE_RUN_SUFFIX)) {
    next = next.slice(0, -WAKE_RUN_SUFFIX.length);
  }
  return next || runId.trim();
}

function isWakeContinuationRun(runId: string): boolean {
  const trimmed = runId.trim();
  if (!trimmed) {
    return false;
  }
  return stripWakeRunSuffixes(trimmed) !== trimmed;
}

async function wakeSubagentRunAfterDescendants(params: {
  runId: string;
  childSessionKey: string;
  taskLabel: string;
  findings: string;
  announceId: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (params.signal?.aborted) {
    return false;
  }

  const childEntry = loadSessionEntryByKey(params.childSessionKey);
  if (!hasUsableSessionEntry(childEntry)) {
    return false;
  }

  const cfg = subagentAnnounceDeps.loadConfig();
  const announceTimeoutMs = resolveSubagentAnnounceTimeoutMs(cfg);
  const wakeMessage = buildDescendantWakeMessage({
    findings: params.findings,
    taskLabel: params.taskLabel,
  });

  let wakeRunId = "";
  try {
    const wakeResponse = await runAnnounceDeliveryWithRetry<{ runId?: string }>({
      operation: "descendant wake agent call",
      signal: params.signal,
      run: async () =>
        await subagentAnnounceDeps.callGateway({
          method: "agent",
          params: {
            sessionKey: params.childSessionKey,
            message: wakeMessage,
            deliver: false,
            inputProvenance: {
              kind: "inter_session",
              sourceSessionKey: params.childSessionKey,
              sourceChannel: INTERNAL_MESSAGE_CHANNEL,
              sourceTool: "subagent_announce",
            },
            idempotencyKey: buildAnnounceIdempotencyKey(`${params.announceId}:wake`),
          },
          timeoutMs: announceTimeoutMs,
        }),
    });
    wakeRunId = normalizeOptionalString(wakeResponse?.runId) ?? "";
  } catch {
    return false;
  }

  if (!wakeRunId) {
    return false;
  }

  const { replaceSubagentRunAfterSteer } = await loadSubagentRegistryRuntime();
  return replaceSubagentRunAfterSteer({
    previousRunId: params.runId,
    nextRunId: wakeRunId,
    preserveFrozenResultFallback: true,
  });
}

export async function runSubagentAnnounceFlow(params: {
  childSessionKey: string;
  childRunId: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  timeoutMs: number;
  cleanup: "delete" | "keep";
  roundOneReply?: string;
  /**
   * Fallback text preserved from the pre-wake run when a wake continuation
   * completes with NO_REPLY despite an earlier final summary already existing.
   */
  fallbackReply?: string;
  waitForCompletion?: boolean;
  startedAt?: number;
  endedAt?: number;
  label?: string;
  outcome?: SubagentRunOutcome;
  announceType?: SubagentAnnounceType;
  expectsCompletionMessage?: boolean;
  spawnMode?: SpawnSubagentMode;
  wakeOnDescendantSettle?: boolean;
  signal?: AbortSignal;
  bestEffortDeliver?: boolean;
  /** When true, deliver completion as a silent system event instead of a
   *  visible channel message. Used for ambient enrichment (DELEGATE | silent). */
  silentAnnounce?: boolean;
  /** When true (with silentAnnounce), trigger a generation cycle on the parent
   *  session after enrichment delivery. Enables autonomous cognition loops
   *  (DELEGATE | silent-wake). */
  wakeOnReturn?: boolean;
}): Promise<boolean> {
  let didAnnounce = false;
  const expectsCompletionMessage = params.expectsCompletionMessage === true;
  const announceType = params.announceType ?? "subagent task";
  let shouldDeleteChildSession = params.cleanup === "delete";
  try {
    let targetRequesterSessionKey = params.requesterSessionKey;
    let targetRequesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
    const childSessionId = (() => {
      const entry = loadSessionEntryByKey(params.childSessionKey);
      return typeof entry?.sessionId === "string" && entry.sessionId.trim()
        ? entry.sessionId.trim()
        : undefined;
    })();
    const settleTimeoutMs = Math.min(Math.max(params.timeoutMs, 1), 120_000);
    let reply = params.roundOneReply;
    let outcome: SubagentRunOutcome | undefined = params.outcome;
    if (childSessionId && isEmbeddedPiRunActive(childSessionId)) {
      const settled = await waitForEmbeddedPiRunEnd(childSessionId, settleTimeoutMs);
      if (!settled && isEmbeddedPiRunActive(childSessionId)) {
        shouldDeleteChildSession = false;
        return false;
      }
    }

    if (!reply && params.waitForCompletion !== false) {
      const wait = await waitForSubagentRunOutcome(params.childRunId, settleTimeoutMs);
      const applied = applySubagentWaitOutcome({
        wait,
        outcome,
        startedAt: params.startedAt,
        endedAt: params.endedAt,
      });
      outcome = applied.outcome;
      params.startedAt = applied.startedAt;
      params.endedAt = applied.endedAt;
    }

    if (!outcome) {
      outcome = { status: "unknown" };
    }

    let requesterDepth = getSubagentDepthFromSessionStore(targetRequesterSessionKey);
    const requesterIsInternalSession = () =>
      requesterDepth >= 1 || isCronSessionKey(targetRequesterSessionKey);

    let childCompletionFindings: string | undefined;
    let subagentRegistryRuntime:
      | Awaited<ReturnType<typeof loadSubagentRegistryRuntime>>
      | undefined;
    try {
      subagentRegistryRuntime = await loadSubagentRegistryRuntime();
      if (
        requesterDepth >= 1 &&
        subagentRegistryRuntime.shouldIgnorePostCompletionAnnounceForSession(
          targetRequesterSessionKey,
        )
      ) {
        return true;
      }

      const pendingChildDescendantRuns = Math.max(
        0,
        subagentRegistryRuntime.countPendingDescendantRuns(params.childSessionKey),
      );
      if (pendingChildDescendantRuns > 0 && announceType !== "cron job") {
        shouldDeleteChildSession = false;
        return false;
      }

      if (typeof subagentRegistryRuntime.listSubagentRunsForRequester === "function") {
        const directChildren = subagentRegistryRuntime.listSubagentRunsForRequester(
          params.childSessionKey,
          {
            requesterRunId: params.childRunId,
          },
        );
        if (Array.isArray(directChildren) && directChildren.length > 0) {
          childCompletionFindings = buildChildCompletionFindings(
            dedupeLatestChildCompletionRows(
              filterCurrentDirectChildCompletionRows(directChildren, {
                requesterSessionKey: params.childSessionKey,
                getLatestSubagentRunByChildSessionKey:
                  subagentRegistryRuntime.getLatestSubagentRunByChildSessionKey,
              }),
            ),
          );
        }
      }
    } catch {
      // Best-effort only.
    }

    const announceId = buildAnnounceIdFromChildRun({
      childSessionKey: params.childSessionKey,
      childRunId: params.childRunId,
    });

    const childRunAlreadyWoken = isWakeContinuationRun(params.childRunId);
    if (
      params.wakeOnDescendantSettle === true &&
      childCompletionFindings?.trim() &&
      !childRunAlreadyWoken
    ) {
      const wakeAnnounceId = buildAnnounceIdFromChildRun({
        childSessionKey: params.childSessionKey,
        childRunId: stripWakeRunSuffixes(params.childRunId),
      });
      const woke = await wakeSubagentRunAfterDescendants({
        runId: params.childRunId,
        childSessionKey: params.childSessionKey,
        taskLabel: params.label || params.task || "task",
        findings: childCompletionFindings,
        announceId: wakeAnnounceId,
        signal: params.signal,
      });
      if (woke) {
        shouldDeleteChildSession = false;
        return true;
      }
    }

    if (!childCompletionFindings) {
      const fallbackReply = normalizeOptionalString(params.fallbackReply);
      const fallbackIsSilent =
        Boolean(fallbackReply) &&
        (isAnnounceSkip(fallbackReply) || isSilentReplyText(fallbackReply, SILENT_REPLY_TOKEN));

      if (!reply) {
        reply = await readSubagentOutput(params.childSessionKey, outcome);
      }

      if (!reply?.trim()) {
        reply = await readLatestSubagentOutputWithRetry({
          sessionKey: params.childSessionKey,
          maxWaitMs: params.timeoutMs,
          outcome,
        });
      }

      if (!reply?.trim() && fallbackReply && !fallbackIsSilent) {
        reply = fallbackReply;
      }

      // A worker can finish just after the first wait request timed out.
      // If we already have real completion content, do one cached recheck so
      // the final completion event prefers the authoritative terminal state.
      // This is best-effort; if the recheck fails, keep the known timeout
      // outcome instead of dropping the announcement entirely.
      if (outcome?.status === "timeout" && reply?.trim() && params.waitForCompletion !== false) {
        try {
          const rechecked = await waitForSubagentRunOutcome(params.childRunId, 0);
          const applied = applySubagentWaitOutcome({
            wait: rechecked,
            outcome,
            startedAt: params.startedAt,
            endedAt: params.endedAt,
          });
          outcome = applied.outcome;
          params.startedAt = applied.startedAt;
          params.endedAt = applied.endedAt;
        } catch {
          // Best-effort recheck; keep the existing timeout outcome on failure.
        }
      }

      if (isAnnounceSkip(reply) || isSilentReplyText(reply, SILENT_REPLY_TOKEN)) {
        if (fallbackReply && !fallbackIsSilent) {
          reply = fallbackReply;
        } else {
          return true;
        }
      }
    }

    if (!outcome) {
      outcome = { status: "unknown" };
    }

    // Track whether the announce delivery should be skipped (silent/skip reply
    // with no fallback). Declared here so chain-hop accounting below still runs.
    let skipAnnounceDelivery = false;

    if (childCompletionFindings?.trim()) {
      // Descendant completions were synthesized successfully; announce that
      // result upward unless we converted it into a wake continuation above.
      reply = childCompletionFindings;
    } else {
      const fallbackReply = params.fallbackReply?.trim() ? params.fallbackReply.trim() : undefined;
      const fallbackIsSilent =
        Boolean(fallbackReply) &&
        (isAnnounceSkip(fallbackReply) || isSilentReplyText(fallbackReply, SILENT_REPLY_TOKEN));

      if (!reply) {
        reply = await readSubagentOutput(params.childSessionKey, outcome);
      }

      if (!reply?.trim()) {
        reply = await readLatestSubagentOutputWithRetry({
          sessionKey: params.childSessionKey,
          maxWaitMs: params.timeoutMs,
          outcome,
        });
      }

      if (!reply?.trim() && fallbackReply && !fallbackIsSilent) {
        reply = fallbackReply;
      }

      // A worker can finish just after the first wait request timed out.
      // If we already have real completion content, do one cached recheck so
      // the final completion event prefers the authoritative terminal state.
      // This is best-effort; if the recheck fails, keep the known timeout
      // outcome instead of dropping the announcement entirely.
      if (outcome?.status === "timeout" && reply?.trim() && params.waitForCompletion !== false) {
        try {
          const rechecked = await waitForSubagentRunOutcome(params.childRunId, 0);
          const applied = applySubagentWaitOutcome({
            wait: rechecked,
            outcome,
            startedAt: params.startedAt,
            endedAt: params.endedAt,
          });
          outcome = applied.outcome;
          params.startedAt = applied.startedAt;
          params.endedAt = applied.endedAt;
        } catch {
          // Best-effort recheck; keep the existing timeout outcome on failure.
        }
      }

      if (isAnnounceSkip(reply) || isSilentReplyText(reply, SILENT_REPLY_TOKEN)) {
        if (fallbackReply && !fallbackIsSilent) {
          reply = fallbackReply;
        } else {
          // Do NOT early-return here — fall through to chain-hop accounting
          // below so that token accumulation, chain guards, and tool-delegate
          // consumption still run for silent/skip replies. Without this,
          // subagents that reply with NO_REPLY bypass cost-cap enforcement
          // and chain-hop accounting entirely (Swim 8, 8-T6 finding).
          skipAnnounceDelivery = true;
        }
      }
    }

    if (!outcome) {
      outcome = { status: "unknown" };
    }

    // Build status label
    const statusLabel =
      outcome.status === "ok"
        ? "completed successfully"
        : outcome.status === "timeout"
          ? "timed out"
          : outcome.status === "error"
            ? `failed: ${outcome.error || "unknown error"}`
            : "finished with unknown status";

    const taskLabel = params.label || params.task || "task";
    const announceSessionId = childSessionId || "unknown";
    let findings = reply || "(no output)";
    if (
      childCompletionFindings?.trim() &&
      findings !== "(no output)" &&
      findings !== childCompletionFindings
    ) {
      findings = `${findings}\n\n[Descendant completions]\n${childCompletionFindings}`;
    }

    // --- Sub-agent continuation chain: accumulate child token cost + parse [[CONTINUE_DELEGATE:]] ---
    const cfg = loadConfig();
    const continuationEnabled = cfg?.agents?.defaults?.continuation?.enabled === true;

    // Accumulate the completing shard's token cost unconditionally on delegate-return,
    // even if the child doesn't emit another [[CONTINUE_DELEGATE:]]. Without this,
    // children that finish normally leak their tokens from the chain budget.
    const childTask = params.task ?? "";
    const isContinuationChainDelegate = /\[continuation:chain-hop:\d+\]/.test(childTask);
    let accumulatedChildTokens = 0;
    if (continuationEnabled && isContinuationChainDelegate) {
      let childEntry = loadSessionEntryByKey(params.childSessionKey);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const hasTokenData =
          typeof childEntry?.inputTokens === "number" ||
          typeof childEntry?.outputTokens === "number";
        if (hasTokenData) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        childEntry = loadSessionEntryByKey(params.childSessionKey);
      }
      accumulatedChildTokens =
        (typeof childEntry?.inputTokens === "number" ? childEntry.inputTokens : 0) +
        (typeof childEntry?.outputTokens === "number" ? childEntry.outputTokens : 0);
      if (accumulatedChildTokens > 0) {
        const parentAgentId = resolveAgentIdFromSessionKey(targetRequesterSessionKey);
        const parentStorePath = resolveStorePath(cfg?.session?.store, {
          agentId: parentAgentId,
        });
        try {
          await updateSessionStore(parentStorePath, (store) => {
            const parentEntry = store[targetRequesterSessionKey];
            if (parentEntry) {
              const prev =
                typeof parentEntry.continuationChainTokens === "number"
                  ? parentEntry.continuationChainTokens
                  : 0;
              parentEntry.continuationChainTokens = prev + accumulatedChildTokens;
            }
          });
          defaultRuntime.log(
            `[subagent-chain-hop] Accumulated ${accumulatedChildTokens} tokens from ${params.childSessionKey} to parent chain cost`,
          );
        } catch (err) {
          defaultRuntime.log(
            `[subagent-chain-hop] Failed to persist token accumulation for ${targetRequesterSessionKey}: ${String(err)}`,
          );
        }
      }
    }

    // --- Consume tool-dispatched delegates from the completing subagent ---
    const toolDelegates =
      continuationEnabled && isContinuationChainDelegate
        ? consumePendingDelegates(params.childSessionKey)
        : [];
    if (toolDelegates.length > 0) {
      defaultRuntime.log(
        `[subagent-chain-hop] Consuming ${toolDelegates.length} tool delegate(s) from subagent ${params.childSessionKey}`,
      );
    }

    // Safety: drain orphaned delegates from non-chain-hop subagents that had tool access.
    if (!isContinuationChainDelegate && continuationEnabled) {
      const orphaned = consumePendingDelegates(params.childSessionKey);
      if (orphaned.length > 0) {
        defaultRuntime.log(
          `[subagent-chain-hop] WARNING: ${orphaned.length} tool delegate(s) orphaned from non-chain-hop subagent ${params.childSessionKey} — drainsContinuationDelegateQueue was set but task has no chain-hop prefix`,
        );
      }
    }

    // Track whether a bracket delegate was consumed from findings — must
    // capture BEFORE stripping mutates findings (P0-1 from review).
    let bracketDelegateConsumed = false;

    if (continuationEnabled && (findings !== "(no output)" || toolDelegates.length > 0)) {
      const continuationResult = stripContinuationSignal(findings);
      if (continuationResult.signal?.kind === "work") {
        defaultRuntime.log(
          `[subagent-chain-hop] CONTINUE_WORK not supported in sub-agent chain (from ${params.childSessionKey}), ignoring`,
        );
      } else if (continuationResult.signal?.kind === "delegate") {
        bracketDelegateConsumed = true;
        findings = continuationResult.text || "(no output)";
        const chainTask = continuationResult.signal.task;
        const chainDelayMs = continuationResult.signal.delayMs;
        const parentWasSilent = params.silentAnnounce === true;
        const chainSilent =
          continuationResult.signal.silent ||
          continuationResult.signal.silentWake ||
          parentWasSilent;
        const chainWake =
          continuationResult.signal.silentWake || (parentWasSilent && params.wakeOnReturn === true);

        const { maxChainLength, costCapTokens, minDelayMs, maxDelayMs } =
          resolveContinuationRuntimeConfig(cfg);

        const hopMatch = childTask.match(/\[continuation:chain-hop:(\d+)\]/);
        const childChainHop = hopMatch ? parseInt(hopMatch[1], 10) : 0;
        const nextChainHop = childChainHop + 1;

        let chainGuardResult:
          | { allowed: false; reason: "chain-length"; chainCount: number; maxChainLength: number }
          | { allowed: false; reason: "cost-cap"; chainTokens: number; costCapTokens: number }
          | { allowed: true; nextChainHop: number };

        if (childChainHop >= maxChainLength) {
          chainGuardResult = {
            allowed: false,
            reason: "chain-length",
            chainCount: nextChainHop,
            maxChainLength,
          };
        } else {
          const parentEntry = loadSessionEntryByKey(targetRequesterSessionKey);
          const storedChainTokens = parentEntry?.continuationChainTokens ?? 0;
          const parentChainTokens =
            storedChainTokens >= accumulatedChildTokens
              ? storedChainTokens
              : storedChainTokens + accumulatedChildTokens;
          if (costCapTokens > 0 && parentChainTokens > costCapTokens) {
            chainGuardResult = {
              allowed: false,
              reason: "cost-cap",
              chainTokens: parentChainTokens,
              costCapTokens,
            };
          } else {
            chainGuardResult = { allowed: true, nextChainHop };
          }
        }

        if (!chainGuardResult.allowed) {
          if (chainGuardResult.reason === "chain-length") {
            defaultRuntime.log(
              `[subagent-chain-hop] Chain length ${chainGuardResult.chainCount} > ${chainGuardResult.maxChainLength}, rejecting hop from ${params.childSessionKey}`,
            );
          } else {
            defaultRuntime.log(
              `[subagent-chain-hop] Cost cap exceeded (${chainGuardResult.chainTokens} > ${chainGuardResult.costCapTokens}), rejecting hop from ${params.childSessionKey}`,
            );
          }
        } else {
          const nextChainHop = chainGuardResult.nextChainHop;

          setDelegatePending(targetRequesterSessionKey);

          const doChainSpawn = async (timerTriggered = false) => {
            try {
              const childDepth = getSubagentDepthFromSessionStore(params.childSessionKey);
              const spawnResult = await spawnSubagentDirect(
                {
                  task: `[continuation:chain-hop:${nextChainHop}] Delegated from sub-agent (depth ${childDepth}): ${chainTask}`,
                  ...(chainSilent ? { silentAnnounce: true } : {}),
                  ...(chainWake ? { silentAnnounce: true, wakeOnReturn: true } : {}),
                  drainsContinuationDelegateQueue: true,
                },
                {
                  agentSessionKey: targetRequesterSessionKey,
                  agentChannel: targetRequesterOrigin?.channel ?? undefined,
                  agentAccountId: targetRequesterOrigin?.accountId ?? undefined,
                  agentTo: targetRequesterOrigin?.to ?? undefined,
                  agentThreadId: targetRequesterOrigin?.threadId ?? undefined,
                },
              );
              if (spawnResult.status === "accepted") {
                defaultRuntime.log(
                  timerTriggered
                    ? `[subagent-chain-hop] Timer fired and spawned chain delegate (${nextChainHop}/${maxChainLength}) from ${params.childSessionKey}: ${chainTask.slice(0, 80)}`
                    : `[subagent-chain-hop] Spawned chain delegate (${nextChainHop}/${maxChainLength}) from ${params.childSessionKey}: ${chainTask.slice(0, 80)}`,
                );
              } else {
                defaultRuntime.log(
                  `[subagent-chain-hop] Spawn rejected (${spawnResult.status}) from ${params.childSessionKey}: ${chainTask.slice(0, 80)}`,
                );
              }
            } catch (err) {
              defaultRuntime.log(
                `[subagent-chain-hop] Spawn failed from ${params.childSessionKey}: ${String(err)}`,
              );
            }
          };

          if (chainDelayMs && chainDelayMs > 0) {
            const clampedDelay = Math.max(minDelayMs, Math.min(maxDelayMs, chainDelayMs));
            const hopGeneration = bumpContinuationGeneration(targetRequesterSessionKey);
            continuationGuardLog.debug(
              `[continuation-guard] Chain-hop timer set: generation=${hopGeneration} delayMs=${clampedDelay} session=${targetRequesterSessionKey}`,
            );
            setTimeout(() => {
              const { generationGuardTolerance } = resolveContinuationRuntimeConfig();
              const currentGen = currentContinuationGeneration(targetRequesterSessionKey);
              const drift = currentGen - hopGeneration;
              continuationGuardLog.debug(
                `[continuation-guard] Chain-hop timer check: stored=${hopGeneration} current=${currentGen} drift=${drift} tolerance=${generationGuardTolerance} session=${targetRequesterSessionKey}`,
              );
              if (drift > generationGuardTolerance) {
                defaultRuntime.log(
                  `[subagent-chain-hop] Timer cancelled (generation drift=${drift} > tolerance=${generationGuardTolerance}) for ${targetRequesterSessionKey}`,
                );
                return;
              }
              doChainSpawn(true).catch((err) => {
                defaultRuntime.log(
                  `[subagent-chain-hop] Unhandled bracket delegate spawn error from ${params.childSessionKey}: ${String(err)}`,
                );
              });
            }, clampedDelay).unref();
          } else {
            // Fire-and-forget — don't block the announce flow
            doChainSpawn().catch((err) => {
              defaultRuntime.log(
                `[subagent-chain-hop] Unhandled bracket delegate spawn error from ${params.childSessionKey}: ${String(err)}`,
              );
            });
          }
        }
      }

      // --- Tool-dispatched delegates from subagent (parallel to bracket delegates above) ---
      if (toolDelegates.length > 0 && isContinuationChainDelegate) {
        const {
          maxChainLength: toolMaxChainLength,
          costCapTokens: toolCostCapTokens,
          minDelayMs: toolMinDelayMs,
          maxDelayMs: toolMaxDelayMs,
        } = resolveContinuationRuntimeConfig(cfg);
        const hopMatch = childTask.match(/\[continuation:chain-hop:(\d+)\]/);
        const childChainHop = hopMatch ? parseInt(hopMatch[1], 10) : 0;
        // Use the flag captured before findings was mutated (not re-parsing stripped text).
        const bracketConsumedHop = bracketDelegateConsumed ? 1 : 0;
        let toolHopBase = childChainHop + bracketConsumedHop;

        const parentWasSilent = params.silentAnnounce === true;

        for (const toolDelegate of toolDelegates) {
          const nextToolHop = toolHopBase + 1;

          if (nextToolHop >= toolMaxChainLength) {
            const remaining = toolDelegates.length - toolDelegates.indexOf(toolDelegate);
            defaultRuntime.log(
              `[subagent-chain-hop] Tool delegate chain length ${nextToolHop} >= ${toolMaxChainLength}, rejecting from ${params.childSessionKey}. ${remaining} delegate(s) dropped.`,
            );
            break;
          }

          const parentEntryForTool = loadSessionEntryByKey(targetRequesterSessionKey);
          const storedToolChainTokens = parentEntryForTool?.continuationChainTokens ?? 0;
          const parentChainTokensForTool =
            storedToolChainTokens >= accumulatedChildTokens
              ? storedToolChainTokens
              : storedToolChainTokens + accumulatedChildTokens;
          if (toolCostCapTokens > 0 && parentChainTokensForTool > toolCostCapTokens) {
            const remaining = toolDelegates.length - toolDelegates.indexOf(toolDelegate);
            defaultRuntime.log(
              `[subagent-chain-hop] Tool delegate cost cap exceeded (${parentChainTokensForTool} > ${toolCostCapTokens}), rejecting from ${params.childSessionKey}. ${remaining} delegate(s) dropped.`,
            );
            break;
          }

          const toolSilent = toolDelegate.silent || toolDelegate.silentWake || parentWasSilent;
          const toolWake =
            toolDelegate.silentWake || (parentWasSilent && params.wakeOnReturn === true);
          const toolDelayMs = toolDelegate.delayMs;

          setDelegatePending(targetRequesterSessionKey);

          const childDepth = getSubagentDepthFromSessionStore(params.childSessionKey);
          const doToolChainSpawn = async (timerTriggered = false) => {
            try {
              const spawnResult = await spawnSubagentDirect(
                {
                  task: `[continuation:chain-hop:${nextToolHop}] Tool-delegated from sub-agent (depth ${childDepth}): ${toolDelegate.task}`,
                  ...(toolSilent ? { silentAnnounce: true } : {}),
                  ...(toolWake ? { silentAnnounce: true, wakeOnReturn: true } : {}),
                  drainsContinuationDelegateQueue: true,
                },
                {
                  agentSessionKey: targetRequesterSessionKey,
                  agentChannel: targetRequesterOrigin?.channel ?? undefined,
                  agentAccountId: targetRequesterOrigin?.accountId ?? undefined,
                  agentTo: targetRequesterOrigin?.to ?? undefined,
                  agentThreadId: targetRequesterOrigin?.threadId ?? undefined,
                },
              );
              if (spawnResult.status === "accepted") {
                defaultRuntime.log(
                  `[subagent-chain-hop] ${timerTriggered ? "Timer: " : ""}Tool delegate (${nextToolHop}/${toolMaxChainLength}) from ${params.childSessionKey}: ${toolDelegate.task.slice(0, 80)}`,
                );
              } else {
                defaultRuntime.log(
                  `[subagent-chain-hop] Tool delegate spawn rejected (${spawnResult.status}) from ${params.childSessionKey}`,
                );
              }
            } catch (err) {
              defaultRuntime.log(
                `[subagent-chain-hop] Tool delegate spawn failed from ${params.childSessionKey}: ${String(err)}`,
              );
            }
          };

          if (toolDelayMs && toolDelayMs > 0) {
            const clampedDelay = Math.max(toolMinDelayMs, Math.min(toolMaxDelayMs, toolDelayMs));
            const hopGeneration = bumpContinuationGeneration(targetRequesterSessionKey);
            continuationGuardLog.debug(
              `[continuation-guard] Tool delegate timer set: generation=${hopGeneration} delayMs=${clampedDelay} session=${targetRequesterSessionKey}`,
            );
            setTimeout(() => {
              const { generationGuardTolerance } = resolveContinuationRuntimeConfig();
              const currentGen = currentContinuationGeneration(targetRequesterSessionKey);
              const drift = currentGen - hopGeneration;
              if (drift > generationGuardTolerance) {
                defaultRuntime.log(
                  `[subagent-chain-hop] Tool delegate timer cancelled (generation drift=${drift} > tolerance=${generationGuardTolerance}) for ${targetRequesterSessionKey}`,
                );
                return;
              }
              doToolChainSpawn(true).catch((err) => {
                defaultRuntime.log(
                  `[subagent-chain-hop] Unhandled tool delegate spawn error from ${params.childSessionKey}: ${String(err)}`,
                );
              });
            }, clampedDelay).unref();
          } else {
            doToolChainSpawn().catch((err) => {
              defaultRuntime.log(
                `[subagent-chain-hop] Unhandled tool delegate spawn error from ${params.childSessionKey}: ${String(err)}`,
              );
            });
          }

          toolHopBase = nextToolHop;
        }
      }
    }

    // If the reply was silent/skip and we fell through for chain-hop accounting,
    // return now before delivery logic.
    if (skipAnnounceDelivery) {
      return true;
    }

    let requesterIsSubagent = requesterIsInternalSession();
    if (requesterIsSubagent) {
      const {
        isSubagentSessionRunActive,
        resolveRequesterForChildSession,
        shouldIgnorePostCompletionAnnounceForSession,
      } = subagentRegistryRuntime ?? (await loadSubagentRegistryRuntime());
      if (!isSubagentSessionRunActive(targetRequesterSessionKey)) {
        if (shouldIgnorePostCompletionAnnounceForSession(targetRequesterSessionKey)) {
          return true;
        }
        const parentSessionEntry = loadSessionEntryByKey(targetRequesterSessionKey);
        const parentSessionAlive = hasUsableSessionEntry(parentSessionEntry);

        if (!parentSessionAlive) {
          const fallback = resolveRequesterForChildSession(targetRequesterSessionKey);
          if (!fallback?.requesterSessionKey) {
            shouldDeleteChildSession = false;
            return false;
          }
          targetRequesterSessionKey = fallback.requesterSessionKey;
          targetRequesterOrigin =
            normalizeDeliveryContext(fallback.requesterOrigin) ?? targetRequesterOrigin;
          requesterDepth = getSubagentDepthFromSessionStore(targetRequesterSessionKey);
          requesterIsSubagent = requesterIsInternalSession();
        }
      }
    }

    const replyInstruction = buildAnnounceReplyInstruction({
      requesterIsSubagent,
      announceType,
      expectsCompletionMessage,
      silentEnrichment: params.silentAnnounce === true,
      silentWakeEnrichment: params.silentAnnounce === true && params.wakeOnReturn === true,
    });
    const statsLine = await buildCompactAnnounceStatsLine({
      sessionKey: params.childSessionKey,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
    });
    const internalEvents: AgentInternalEvent[] = [
      {
        type: "task_completion",
        source: announceType === "cron job" ? "cron" : "subagent",
        childSessionKey: params.childSessionKey,
        childSessionId: announceSessionId,
        announceType,
        taskLabel,
        status: outcome.status,
        statusLabel,
        result: findings,
        statsLine,
        replyInstruction,
      },
    ];
    const triggerMessage = buildAnnounceSteerMessage(internalEvents);

    // Send to the requester session. For nested subagents this is an internal
    // follow-up injection (deliver=false) so the orchestrator receives it.
    let directOrigin = targetRequesterOrigin;
    if (!requesterIsSubagent) {
      const { entry } = loadRequesterSessionEntry(targetRequesterSessionKey);
      directOrigin = resolveAnnounceOrigin(entry, targetRequesterOrigin);
    }
    const completionDirectOrigin =
      expectsCompletionMessage && !requesterIsSubagent
        ? await resolveSubagentCompletionOrigin({
            childSessionKey: params.childSessionKey,
            requesterSessionKey: targetRequesterSessionKey,
            requesterOrigin: directOrigin,
            childRunId: params.childRunId,
            spawnMode: params.spawnMode,
            expectsCompletionMessage,
          })
        : targetRequesterOrigin;
    const directIdempotencyKey = buildAnnounceIdempotencyKey(announceId);
    // Only tag as delegate-return when the completing run was a continuation
    // delegate (task contains chain-hop marker). Regular subagent completions
    // should not trigger continuation chain state preservation.
    // Note: silentAnnounce delegates return early above and never reach here.
    // Only the task prefix identifies continuation delegates in the non-silent path.
    const isContinuationDelegateRun = /\[continuation:chain-hop:\d+\]/.test(params.task ?? "");
    const cfg2 = loadConfig();
    const continuationEnabledForTrigger = cfg2?.agents?.defaults?.continuation?.enabled === true;
    const delegateReturnTrigger =
      continuationEnabledForTrigger && isContinuationDelegateRun ? "delegate-return" : undefined;
    const delivery = await deliverSubagentAnnouncement({
      requesterSessionKey: targetRequesterSessionKey,
      announceId,
      triggerMessage,
      steerMessage: triggerMessage,
      internalEvents,
      summaryLine: taskLabel,
      requesterSessionOrigin: targetRequesterOrigin,
      requesterOrigin:
        expectsCompletionMessage && !requesterIsSubagent
          ? completionDirectOrigin
          : targetRequesterOrigin,
      completionDirectOrigin,
      directOrigin,
      sourceSessionKey: params.childSessionKey,
      sourceChannel: INTERNAL_MESSAGE_CHANNEL,
      sourceTool: "subagent_announce",
      targetRequesterSessionKey,
      requesterIsSubagent,
      expectsCompletionMessage: expectsCompletionMessage,
      bestEffortDeliver: params.bestEffortDeliver,
      directIdempotencyKey,
      signal: params.signal,
      continuationTriggerOverride: delegateReturnTrigger,
    });
    didAnnounce = delivery.delivered;
    if (!delivery.delivered && delivery.path === "direct" && delivery.error) {
      defaultRuntime.error?.(
        `Subagent completion direct announce failed for run ${params.childRunId}: ${delivery.error}`,
      );
    }
  } catch (err) {
    defaultRuntime.error?.(`Subagent announce failed: ${String(err)}`);
    // Best-effort follow-ups; ignore failures to avoid breaking the caller response.
  } finally {
    // Patch label after all writes complete
    if (params.label) {
      try {
        await subagentAnnounceDeps.callGateway({
          method: "sessions.patch",
          params: { key: params.childSessionKey, label: params.label },
          timeoutMs: 10_000,
        });
      } catch {
        // Best-effort
      }
    }
    if (shouldDeleteChildSession) {
      try {
        await subagentAnnounceDeps.callGateway({
          method: "sessions.delete",
          params: {
            key: params.childSessionKey,
            deleteTranscript: true,
            emitLifecycleHooks: params.spawnMode === "session",
          },
          timeoutMs: 10_000,
        });
      } catch {
        // ignore
      }
    }
  }
  return didAnnounce;
}

export const __testing = {
  setDepsForTest(overrides?: Partial<SubagentAnnounceDeps>) {
    subagentAnnounceDeps = overrides
      ? {
          ...defaultSubagentAnnounceDeps,
          ...overrides,
        }
      : defaultSubagentAnnounceDeps;
  },
};
