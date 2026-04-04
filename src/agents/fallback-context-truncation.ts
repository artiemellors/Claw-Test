/**
 * Context truncation utilities for fallback model degradation.
 *
 * When a fallback model has a smaller context window, these functions
 * trim the session history to fit within the token budget while
 * preserving the most recent conversation context.
 */

/** Rough token estimate using char-count / 4 heuristic. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageTokenEstimate(msg: { role?: string; content?: unknown }): number {
  if (typeof msg.content === "string") return estimateTokens(msg.content);
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((sum: number, block: unknown) => {
      if (typeof block === "string") return sum + estimateTokens(block);
      if (block && typeof block === "object" && "text" in block) {
        return sum + estimateTokens(String((block as { text: string }).text));
      }
      return sum + 50; // rough estimate for non-text blocks
    }, 0);
  }
  return 50;
}

export type TruncatableMessage = { role?: string; content?: unknown; [key: string]: unknown };

/**
 * Truncate a session message array to fit within a token budget.
 *
 * Preserves the first system message and keeps the most recent
 * user/assistant messages that fit within `maxTokens`.
 *
 * @returns Truncated message array.
 */
export function truncateSessionForContext(
  messages: TruncatableMessage[],
  maxTokens: number,
): TruncatableMessage[] {
  if (!messages.length || maxTokens <= 0) return [];

  // Separate system messages from conversation
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");

  // Budget: system messages are always included
  let usedTokens = systemMessages.reduce((sum, m) => sum + messageTokenEstimate(m), 0);
  const remaining = maxTokens - usedTokens;
  if (remaining <= 0) return systemMessages.slice(0, 1);

  // Walk conversation from most recent, adding messages until budget exhausted
  const kept: TruncatableMessage[] = [];
  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    const cost = messageTokenEstimate(conversationMessages[i]);
    if (usedTokens + cost > maxTokens) break;
    usedTokens += cost;
    kept.unshift(conversationMessages[i]);
  }

  return [...systemMessages, ...kept];
}
