import {
  normalizeAssistantPhase,
  parseAssistantTextSignature,
  type AssistantPhase,
} from "../shared/chat-message-content.js";

type AssistantPhaseCarrier = {
  phase?: unknown;
  content?: unknown;
};

export type { AssistantPhase };

export function resolveAssistantPhase(
  message: AssistantPhaseCarrier | null | undefined,
): AssistantPhase | undefined {
  const directPhase = normalizeAssistantPhase(message?.phase);
  if (directPhase) {
    return directPhase;
  }
  if (!Array.isArray(message?.content)) {
    return undefined;
  }
  const explicitPhases = new Set<AssistantPhase>();
  for (const part of message.content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const record = part as { type?: unknown; textSignature?: unknown };
    if (record.type !== "text") {
      continue;
    }
    const phase = parseAssistantTextSignature(record.textSignature)?.phase;
    if (phase) {
      explicitPhases.add(phase);
    }
  }
  return explicitPhases.size === 1 ? [...explicitPhases][0] : undefined;
}
