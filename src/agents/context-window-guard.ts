import type { OpenClawConfig } from "../config/config.js";
import type { AgentModelEntryConfig } from "../config/types.agent-defaults.js";
import { findNormalizedProviderValue } from "./provider-id.js";
import { modelKey } from "./model-selection.js";

/** Context mode determines how aggressively context is trimmed for a model. */
export type ContextMode = "full" | "light" | "safe";

/**
 * Resolve the `contextMode` for a given model from the agent config.
 * Reads `agents.defaults.models[provider/model].params.contextMode`.
 * Returns `"full"` when not configured.
 */
export function resolveModelContextMode(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
}): ContextMode {
  const modelsMap = params.cfg?.agents?.defaults?.models as
    | Record<string, AgentModelEntryConfig>
    | undefined;
  if (!modelsMap) return "full";
  const key = modelKey(params.provider, params.modelId);
  const entry = modelsMap[key] ?? modelsMap[params.modelId];
  const raw = (entry?.params as Record<string, unknown> | undefined)?.contextMode;
  if (raw === "safe" || raw === "light") return raw;
  return "full";
}

export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

export type ContextWindowSource = "model" | "modelsConfig" | "agentContextTokens" | "default";

export type ContextWindowInfo = {
  tokens: number;
  source: ContextWindowSource;
};

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const int = Math.floor(value);
  return int > 0 ? int : null;
}

export function resolveContextWindowInfo(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  modelContextTokens?: number;
  modelContextWindow?: number;
  defaultTokens: number;
}): ContextWindowInfo {
  const fromModelsConfig = (() => {
    const providers = params.cfg?.models?.providers as
      | Record<
          string,
          { models?: Array<{ id?: string; contextTokens?: number; contextWindow?: number }> }
        >
      | undefined;
    const providerEntry = findNormalizedProviderValue(providers, params.provider);
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    const match = models.find((m) => m?.id === params.modelId);
    return normalizePositiveInt(match?.contextTokens) ?? normalizePositiveInt(match?.contextWindow);
  })();
  const fromModel =
    normalizePositiveInt(params.modelContextTokens) ??
    normalizePositiveInt(params.modelContextWindow);
  const baseInfo = fromModelsConfig
    ? { tokens: fromModelsConfig, source: "modelsConfig" as const }
    : fromModel
      ? { tokens: fromModel, source: "model" as const }
      : { tokens: Math.floor(params.defaultTokens), source: "default" as const };

  const capTokens = normalizePositiveInt(params.cfg?.agents?.defaults?.contextTokens);
  if (capTokens && capTokens < baseInfo.tokens) {
    return { tokens: capTokens, source: "agentContextTokens" };
  }

  return baseInfo;
}

export type ContextWindowGuardResult = ContextWindowInfo & {
  shouldWarn: boolean;
  shouldBlock: boolean;
};

export { type ContextMode as FallbackContextMode };

export function evaluateContextWindowGuard(params: {
  info: ContextWindowInfo;
  warnBelowTokens?: number;
  hardMinTokens?: number;
}): ContextWindowGuardResult {
  const warnBelow = Math.max(
    1,
    Math.floor(params.warnBelowTokens ?? CONTEXT_WINDOW_WARN_BELOW_TOKENS),
  );
  const hardMin = Math.max(1, Math.floor(params.hardMinTokens ?? CONTEXT_WINDOW_HARD_MIN_TOKENS));
  const tokens = Math.max(0, Math.floor(params.info.tokens));
  return {
    ...params.info,
    tokens,
    shouldWarn: tokens > 0 && tokens < warnBelow,
    shouldBlock: tokens > 0 && tokens < hardMin,
  };
}
