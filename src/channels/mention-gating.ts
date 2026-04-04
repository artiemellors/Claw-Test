export type MentionGateParams = {
  requireMention: boolean;
  canDetectMention: boolean;
  wasMentioned: boolean;
  implicitMention?: boolean;
  /**
   * True when the bot has previously participated in this thread (via
   * persistent or cached state).  Separated from implicitMention so that
   * root-message mention gating and thread-continuation gating can be
   * distinguished in logs and logic.  When set, it contributes to
   * effectiveWasMentioned independently of implicitMention.
   */
  threadContinuation?: boolean;
  shouldBypassMention?: boolean;
};

export type MentionGateResult = {
  effectiveWasMentioned: boolean;
  shouldSkip: boolean;
};

export type MentionGateWithBypassParams = {
  isGroup: boolean;
  requireMention: boolean;
  canDetectMention: boolean;
  wasMentioned: boolean;
  implicitMention?: boolean;
  threadContinuation?: boolean;
  hasAnyMention?: boolean;
  allowTextCommands: boolean;
  hasControlCommand: boolean;
  commandAuthorized: boolean;
};

export type MentionGateWithBypassResult = MentionGateResult & {
  shouldBypassMention: boolean;
};

export function resolveMentionGating(params: MentionGateParams): MentionGateResult {
  const implicit = params.implicitMention === true;
  const continuation = params.threadContinuation === true;
  const bypass = params.shouldBypassMention === true;
  const effectiveWasMentioned = params.wasMentioned || implicit || continuation || bypass;
  const shouldSkip = params.requireMention && params.canDetectMention && !effectiveWasMentioned;
  return { effectiveWasMentioned, shouldSkip };
}

export function resolveMentionGatingWithBypass(
  params: MentionGateWithBypassParams,
): MentionGateWithBypassResult {
  const shouldBypassMention =
    params.isGroup &&
    params.requireMention &&
    !params.wasMentioned &&
    !(params.hasAnyMention ?? false) &&
    params.allowTextCommands &&
    params.commandAuthorized &&
    params.hasControlCommand;
  return {
    ...resolveMentionGating({
      requireMention: params.requireMention,
      canDetectMention: params.canDetectMention,
      wasMentioned: params.wasMentioned,
      implicitMention: params.implicitMention,
      threadContinuation: params.threadContinuation,
      shouldBypassMention,
    }),
    shouldBypassMention,
  };
}
