import type { VerboseLevel } from "../auto-reply/thinking.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";

export type AgentEventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

export type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
  requestedStructuredOutput?: boolean;
  /** Whether control UI clients should receive chat/agent updates for this run. */
  isControlUiVisible?: boolean;
};

type AgentEventState = {
  seqByRun: Map<string, number>;
  listeners: Set<(evt: AgentEventPayload) => void>;
  runContextById: Map<string, AgentRunContext>;
  structuredOutputIntentById: Map<string, { value: boolean; ts: number }>;
};

const AGENT_EVENT_STATE_KEY = Symbol.for("openclaw.agentEvents.state");
const STRUCTURED_OUTPUT_INTENT_TTL_MS = 10 * 60_000;

function getAgentEventState(): AgentEventState {
  return resolveGlobalSingleton<AgentEventState>(AGENT_EVENT_STATE_KEY, () => ({
    seqByRun: new Map<string, number>(),
    listeners: new Set<(evt: AgentEventPayload) => void>(),
    runContextById: new Map<string, AgentRunContext>(),
    structuredOutputIntentById: new Map<string, { value: boolean; ts: number }>(),
  }));
}

function pruneStructuredOutputIntent(now = Date.now()) {
  const state = getAgentEventState();
  for (const [runId, entry] of state.structuredOutputIntentById) {
    if (now - entry.ts > STRUCTURED_OUTPUT_INTENT_TTL_MS) {
      state.structuredOutputIntentById.delete(runId);
    }
  }
}

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) {
    return;
  }
  const state = getAgentEventState();
  const existing = state.runContextById.get(runId);
  if (!existing) {
    state.runContextById.set(runId, { ...context });
    if (context.requestedStructuredOutput) {
      pruneStructuredOutputIntent();
      state.structuredOutputIntentById.set(runId, {
        value: true,
        ts: Date.now(),
      });
    } else {
      state.structuredOutputIntentById.delete(runId);
    }
    return;
  }
  if (context.sessionKey && existing.sessionKey !== context.sessionKey) {
    existing.sessionKey = context.sessionKey;
  }
  if (context.verboseLevel && existing.verboseLevel !== context.verboseLevel) {
    existing.verboseLevel = context.verboseLevel;
  }
  if (context.isControlUiVisible !== undefined) {
    existing.isControlUiVisible = context.isControlUiVisible;
  }
  if (context.isHeartbeat !== undefined && existing.isHeartbeat !== context.isHeartbeat) {
    existing.isHeartbeat = context.isHeartbeat;
  }
  if (
    context.requestedStructuredOutput !== undefined &&
    existing.requestedStructuredOutput !== context.requestedStructuredOutput
  ) {
    existing.requestedStructuredOutput = context.requestedStructuredOutput;
  }
  if (context.requestedStructuredOutput !== undefined) {
    if (context.requestedStructuredOutput) {
      pruneStructuredOutputIntent();
      state.structuredOutputIntentById.set(runId, {
        value: true,
        ts: Date.now(),
      });
    } else {
      state.structuredOutputIntentById.delete(runId);
    }
  }
}

export function getAgentRunContext(runId: string) {
  return getAgentEventState().runContextById.get(runId);
}

export function getAgentRequestedStructuredOutputIntent(runId: string): boolean | undefined {
  const contextValue = getAgentRunContext(runId)?.requestedStructuredOutput;
  if (contextValue !== undefined) {
    return contextValue;
  }
  pruneStructuredOutputIntent();
  return getAgentEventState().structuredOutputIntentById.get(runId)?.value;
}

export function clearAgentRunContext(runId: string) {
  const state = getAgentEventState();
  const context = state.runContextById.get(runId);
  if (context?.requestedStructuredOutput === true) {
    pruneStructuredOutputIntent();
    state.structuredOutputIntentById.set(runId, {
      value: true,
      ts: Date.now(),
    });
  }
  state.runContextById.delete(runId);
}

export function resetAgentRunContextForTest() {
  const state = getAgentEventState();
  state.runContextById.clear();
  state.structuredOutputIntentById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const state = getAgentEventState();
  const nextSeq = (state.seqByRun.get(event.runId) ?? 0) + 1;
  state.seqByRun.set(event.runId, nextSeq);
  const context = state.runContextById.get(event.runId);
  const isControlUiVisible = context?.isControlUiVisible ?? true;
  const eventSessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim() ? event.sessionKey : undefined;
  const sessionKey = isControlUiVisible ? (eventSessionKey ?? context?.sessionKey) : undefined;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    seq: nextSeq,
    ts: Date.now(),
  };
  notifyListeners(state.listeners, enriched);
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  const state = getAgentEventState();
  return registerListener(state.listeners, listener);
}

export function resetAgentEventsForTest() {
  const state = getAgentEventState();
  state.seqByRun.clear();
  state.listeners.clear();
  state.runContextById.clear();
  state.structuredOutputIntentById.clear();
}
