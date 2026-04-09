function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const STRUCTURED_OUTPUT_PATTERNS: RegExp[] = [
  /\b(json|yaml|xml|csv|sql|table|steps?|summary|report|recap)\b/iu,
  /```/u,
];

const TECHNICAL_DENSE_PATTERNS: RegExp[] = [
  /\b(stack trace|exception|traceback|compile error|build log|diff|patch)\b/iu,
  /```/u,
];

const CONVERSATIONAL_SIGNAL_PATTERNS: RegExp[] = [
  /^(?:this|that|it|can you|could you|please|how|is it|ok|okay|got it|sounds good|go ahead|thanks)\b/iu,
];

const SHORT_ACK_OR_FOLLOWUP_PATTERNS: RegExp[] = [
  /^(?:ok|okay|got it|sounds good|go ahead|thanks|thank you|please do|can you|could you|how is it going|is it okay|does that work)\b[\s?!.]*$/iu,
  /^(?:this|that|it)\b(?:[\s?!.].*)?$/iu,
];

export function shouldApplyChatShaping(params: {
  userText?: string;
  replyToBody?: string;
  threadHistoryBody?: string;
  threadStarterBody?: string;
  isGroupChat?: boolean;
}): boolean {
  const userText = normalizeWhitespace(params.userText ?? "");
  if (!userText) {
    return false;
  }

  if (userText.length > 1200) {
    return false;
  }

  if (STRUCTURED_OUTPUT_PATTERNS.some((pattern) => pattern.test(userText))) {
    return false;
  }

  if (TECHNICAL_DENSE_PATTERNS.some((pattern) => pattern.test(userText))) {
    return false;
  }

  const hasNearbyContext = Boolean(
    params.replyToBody || params.threadHistoryBody || params.threadStarterBody,
  );

  if (params.isGroupChat && !hasNearbyContext) {
    return false;
  }

  const isShortConversationalSignal =
    userText.length <= 40 &&
    CONVERSATIONAL_SIGNAL_PATTERNS.some((pattern) => pattern.test(userText));
  if (isShortConversationalSignal && (!params.isGroupChat || hasNearbyContext)) {
    return true;
  }

  if (!hasNearbyContext) {
    return false;
  }

  if (userText.length > 40) {
    return false;
  }

  return SHORT_ACK_OR_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(userText));
}

export function buildChatShapingNote(params: {
  userText?: string;
  replyToBody?: string;
  threadHistoryBody?: string;
  threadStarterBody?: string;
  isGroupChat?: boolean;
}): string | undefined {
  if (!shouldApplyChatShaping(params)) {
    return undefined;
  }

  return [
    "[Chat shaping guidance]",
    "This appears to be a conversational reply, not a formal structured output request.",
    "Preserve the assistant's existing persona and voice signals from the active system/persona instructions, especially stable expression defaults defined in files such as SOUL.md and IDENTITY.md when present.",
    "Treat those persona defaults as durable normal-chat behavior, not optional decoration.",
    "Do not flatten away persona-specific reaction words, pacing, opener style, or low-risk expressive markers merely for polish.",
    "When the persona definition includes preferred expressive signals such as emoji, naturally use them in normal chat replies when they fit the context instead of suppressing them by default.",
    "Prefer persona-consistent response-shaped openings in conversational exchanges, including short acknowledgements and progress updates.",
    "Use bullets or headings only if they materially improve clarity or execution.",
    "Keep expression context-appropriate and avoid flattening into generic assistant wording.",
    "If giving an in-progress update during active work, keep it brief, meaningful, bounded under the user's existing intent, and still persona-consistent.",
    "If the user explicitly requests structured output or the situation is safety-critical, clarity-first formatting can override these expression defaults.",
  ].join("\n");
}
