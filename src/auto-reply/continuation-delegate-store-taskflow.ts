/**
 * Task Flow-backed implementation of the pending continuation delegate store.
 *
 * Each pending delegate is modeled as a managed TaskFlow record with
 * `controllerId = "core/continuation-delegate"` and status `"queued"`.
 * Delegate fields are stored in `stateJson`; `goal` mirrors the task string.
 *
 * This gives delegates SQLite-backed persistence (survive gateway restarts),
 * cancel/retry semantics, and lifecycle tracking through the Task Flow registry.
 *
 * Gated behind `agents.defaults.continuation.taskFlowDelegates` (opt-in).
 * The volatile Map store remains the default fallback.
 */

import {
  createManagedTaskFlow,
  finishFlow,
  listTaskFlowsForOwnerKey,
  requestFlowCancel,
  updateFlowRecordByIdExpectedRevision,
} from "../tasks/task-flow-registry.js";
import type { TaskFlowRecord, JsonValue } from "../tasks/task-flow-registry.types.js";
import type { PendingContinuationDelegate } from "./continuation-delegate-store.js";

const CONTROLLER_ID = "core/continuation-delegate";

function delegateToStateJson(delegate: PendingContinuationDelegate): JsonValue {
  const state: Record<string, JsonValue> = { task: delegate.task };
  if (delegate.delayMs != null) {
    state.delayMs = delegate.delayMs;
  }
  if (delegate.silent != null) {
    state.silent = delegate.silent;
  }
  if (delegate.silentWake != null) {
    state.silentWake = delegate.silentWake;
  }
  return state;
}

function flowToDelegate(flow: TaskFlowRecord): PendingContinuationDelegate {
  const state = (flow.stateJson ?? {}) as Record<string, unknown>;
  const delegate: PendingContinuationDelegate = {
    task: typeof state.task === "string" ? state.task : flow.goal,
  };
  if (typeof state.delayMs === "number") {
    delegate.delayMs = state.delayMs;
  }
  if (typeof state.silent === "boolean") {
    delegate.silent = state.silent;
  }
  if (typeof state.silentWake === "boolean") {
    delegate.silentWake = state.silentWake;
  }
  return delegate;
}

function listPendingFlows(sessionKey: string): TaskFlowRecord[] {
  return listTaskFlowsForOwnerKey(sessionKey)
    .filter((f) => f.controllerId === CONTROLLER_ID && f.status === "queued")
    .toSorted((a, b) => a.createdAt - b.createdAt);
}

/**
 * Enqueue a pending delegate as a TaskFlow record.
 */
export function taskFlowEnqueuePendingDelegate(
  sessionKey: string,
  delegate: PendingContinuationDelegate,
): void {
  createManagedTaskFlow({
    ownerKey: sessionKey,
    controllerId: CONTROLLER_ID,
    goal: delegate.task,
    stateJson: delegateToStateJson(delegate),
    status: "queued",
  });
}

/**
 * Consume (drain) all pending delegates for a session.
 * Returns delegates in FIFO order and transitions backing flow records
 * from "queued" → "succeeded" (proper lifecycle, not delete).
 */
export function taskFlowConsumePendingDelegates(sessionKey: string): PendingContinuationDelegate[] {
  const flows = listPendingFlows(sessionKey);
  const delegates: PendingContinuationDelegate[] = [];
  for (const flow of flows) {
    delegates.push(flowToDelegate(flow));
    finishFlow({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
    });
  }
  return delegates;
}

/**
 * Count of pending delegates for a session without consuming them.
 */
export function taskFlowPendingDelegateCount(sessionKey: string): number {
  return listPendingFlows(sessionKey).length;
}

/**
 * Cancel all pending TaskFlow delegates for a session.
 * Called when an external message arrives or a session is reset.
 * Records persist with cancelled status for audit trail.
 */
export function taskFlowCancelPendingDelegates(sessionKey: string): void {
  const flows = listPendingFlows(sessionKey);
  for (const flow of flows) {
    // Mark cancel intent (sticky timestamp).
    const cancelResult = requestFlowCancel({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
    });
    // Transition to terminal "cancelled" status.
    if (cancelResult.applied) {
      updateFlowRecordByIdExpectedRevision({
        flowId: flow.flowId,
        expectedRevision: cancelResult.flow.revision,
        patch: {
          status: "cancelled",
          endedAt: Date.now(),
        },
      });
    }
  }
}
