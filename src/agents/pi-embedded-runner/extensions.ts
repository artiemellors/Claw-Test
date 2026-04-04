import type { ExtensionFactory, SessionManager } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../../config/config.js";
import type { ProviderRuntimeModel } from "../../plugins/types.js";
import { resolveContextWindowInfo } from "../context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { setCompactionSafeguardRuntime } from "../pi-hooks/compaction-safeguard-runtime.js";
import compactionSafeguardExtension from "../pi-hooks/compaction-safeguard.js";
import contextPruningExtension from "../pi-hooks/context-pruning.js";
import { setContextPruningRuntime } from "../pi-hooks/context-pruning/runtime.js";
import { computeEffectiveSettings } from "../pi-hooks/context-pruning/settings.js";
import { makeToolPrunablePredicate } from "../pi-hooks/context-pruning/tools.js";
import { ensurePiCompactionReserveTokens } from "../pi-settings.js";
import { resolveTranscriptPolicy } from "../transcript-policy.js";
import { isCacheTtlEligibleProvider, readLastCacheTtlTimestamp } from "./cache-ttl.js";

function resolveContextWindowTokens(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
}): number {
  return resolveContextWindowInfo({
    cfg: params.cfg,
    provider: params.provider,
    modelId: params.modelId,
    modelContextTokens: params.model?.contextTokens,
    modelContextWindow: params.model?.contextWindow,
    defaultTokens: DEFAULT_CONTEXT_TOKENS,
  }).tokens;
}

function buildContextPruningFactory(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
}): ExtensionFactory | undefined {
  const raw = params.cfg?.agents?.defaults?.contextPruning;
  if (raw?.mode !== "cache-ttl") {
    return undefined;
  }
  if (!isCacheTtlEligibleProvider(params.provider, params.modelId, params.model?.api)) {
    return undefined;
  }

  const settings = computeEffectiveSettings(raw);
  if (!settings) {
    return undefined;
  }
  const transcriptPolicy = resolveTranscriptPolicy({
    modelApi: params.model?.api,
    provider: params.provider,
    modelId: params.modelId,
  });

  setContextPruningRuntime(params.sessionManager, {
    settings,
    contextWindowTokens: resolveContextWindowTokens(params),
    isToolPrunable: makeToolPrunablePredicate(settings.tools),
    dropThinkingBlocks: transcriptPolicy.dropThinkingBlocks,
    lastCacheTouchAt: readLastCacheTtlTimestamp(params.sessionManager, {
      provider: params.provider,
      modelId: params.modelId,
    }),
  });

  return contextPruningExtension;
}

function resolveCompactionMode(cfg?: OpenClawConfig): "default" | "safeguard" {
  const compaction = cfg?.agents?.defaults?.compaction;
  // A registered compaction provider requires the safeguard extension path
  if (compaction?.provider) {
    return "safeguard";
  }
  return compaction?.mode === "safeguard" ? "safeguard" : "default";
}

export function buildEmbeddedExtensionFactories(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
}): ExtensionFactory[] {
  const factories: ExtensionFactory[] = [];
  if (resolveCompactionMode(params.cfg) === "safeguard") {
    const compactionCfg = params.cfg?.agents?.defaults?.compaction;
    const qualityGuardCfg = compactionCfg?.qualityGuard;
    const contextWindowInfo = resolveContextWindowInfo({
      cfg: params.cfg,
      provider: params.provider,
      modelId: params.modelId,
      modelContextTokens: params.model?.contextTokens,
      modelContextWindow: params.model?.contextWindow,
      defaultTokens: DEFAULT_CONTEXT_TOKENS,
    });
    setCompactionSafeguardRuntime(params.sessionManager, {
      maxHistoryShare: compactionCfg?.maxHistoryShare,
      contextWindowTokens: contextWindowInfo.tokens,
      identifierPolicy: compactionCfg?.identifierPolicy,
      identifierInstructions: compactionCfg?.identifierInstructions,
      customInstructions: compactionCfg?.customInstructions,
      qualityGuardEnabled: qualityGuardCfg?.enabled ?? false,
      qualityGuardMaxRetries: qualityGuardCfg?.maxRetries,
      model: params.model,
      recentTurnsPreserve: compactionCfg?.recentTurnsPreserve,
      provider: compactionCfg?.provider,
    });
    factories.push(compactionSafeguardExtension);
  }
  const pruningFactory = buildContextPruningFactory(params);
  if (pruningFactory) {
    factories.push(pruningFactory);
  }
  return factories;
}

export { ensurePiCompactionReserveTokens };

import type { ContextMode } from "../context-window-guard.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const extensionsLog = createSubsystemLogger("extensions-context-mode");

/** Default file priority for light mode when LIGHT.md is absent. */
const DEFAULT_LIGHT_MODE_PRIORITY = [
  "IDENTITY.md",
  "SOUL.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
];

/** Hardcoded fallback when SAFE.md is absent. */
const DEFAULT_SAFE_INSTRUCTIONS =
  "You are in safe mode (cloud model unavailable). Execute commands and read files only. Keep responses brief.";

/**
 * Parse LIGHT.md content into an ordered list of workspace file names.
 * Lines starting with `#` and blank lines are skipped.
 */
export function loadLightModeFileOrder(lightMdContent: string | null): string[] {
  if (!lightMdContent) return [...DEFAULT_LIGHT_MODE_PRIORITY];
  const lines = lightMdContent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  return lines.length > 0 ? lines : [...DEFAULT_LIGHT_MODE_PRIORITY];
}

/**
 * Warn about workspace files that exceed 10% of the model's context window.
 */
export function warnOversizedFiles(
  files: Array<{ path: string; content: string }>,
  contextWindowTokens: number,
): void {
  const threshold = contextWindowTokens * 0.1;
  for (const file of files) {
    const estimatedTokens = Math.ceil(file.content.length / 4);
    if (estimatedTokens > threshold) {
      const pct = Math.round((estimatedTokens / contextWindowTokens) * 100);
      const name = file.path.split("/").pop() ?? file.path;
      extensionsLog.warn(
        `⚠️ ${name} is ~${estimatedTokens} tokens (${pct}% of ${contextWindowTokens} context) — consider trimming for fallback compatibility`,
      );
    }
  }
}

/**
 * Filter workspace context files based on the resolved context mode.
 *
 * - `"full"`: returns all files unchanged.
 * - `"safe"`: returns only SAFE.md content (or hardcoded default).
 * - `"light"`: loads files in priority order up to 50% of `contextWindowTokens`.
 */
export function applyContextModeFilter(params: {
  contextMode: ContextMode;
  files: Array<{ path: string; content: string }>;
  contextWindowTokens: number;
  safeMdContent?: string | null;
  lightMdContent?: string | null;
}): Array<{ path: string; content: string }> {
  if (params.contextMode === "full") return params.files;

  if (params.contextMode === "safe") {
    const safeContent =
      params.safeMdContent?.trim() || DEFAULT_SAFE_INSTRUCTIONS;
    return [{ path: "SAFE.md", content: safeContent }];
  }

  // Light mode: load files in priority order up to 50% budget
  const budget = Math.floor(params.contextWindowTokens * 0.5);
  const priority = loadLightModeFileOrder(params.lightMdContent ?? null);
  const fileMap = new Map(params.files.map((f) => {
    const name = f.path.split("/").pop() ?? f.path;
    return [name, f];
  }));

  warnOversizedFiles(params.files, params.contextWindowTokens);

  const result: Array<{ path: string; content: string }> = [];
  let usedTokens = 0;

  for (const fileName of priority) {
    const file = fileMap.get(fileName);
    if (!file) continue;
    const estimatedTokens = Math.ceil(file.content.length / 4);
    if (usedTokens + estimatedTokens > budget) {
      // Truncate partial file at token boundary
      const remainingTokens = budget - usedTokens;
      if (remainingTokens > 100) {
        const truncatedContent = file.content.slice(0, remainingTokens * 4);
        result.push({ path: file.path, content: truncatedContent });
      }
      break;
    }
    usedTokens += estimatedTokens;
    result.push(file);
  }

  return result;
}
