import { normalizeLowercaseStringOrEmpty } from "./string-coerce.ts";
import type { ModelCatalogEntry } from "./types.ts";

export type ChatModelOverride =
  | {
      kind: "qualified";
      value: string;
    }
  | {
      kind: "raw";
      value: string;
    };

export type ChatModelResolutionSource = "empty" | "qualified" | "catalog" | "raw" | "server";

export type ChatModelResolutionReason = "empty" | "missing" | "ambiguous";

export type ChatModelResolution = {
  value: string;
  source: ChatModelResolutionSource;
  reason?: ChatModelResolutionReason;
};

export function buildQualifiedChatModelValue(model: string, provider?: string | null): string {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    return "";
  }
  // Preserve already-qualified model refs (provider/model) as-is.
  // This avoids prepending an unrelated/default provider.
  if (trimmedModel.includes("/")) {
    return trimmedModel;
  }
  const trimmedProvider = provider?.trim();
  return trimmedProvider ? `${trimmedProvider}/${trimmedModel}` : trimmedModel;
}

export function createChatModelOverride(value: string): ChatModelOverride | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("/")) {
    return { kind: "qualified", value: trimmed };
  }
  return { kind: "raw", value: trimmed };
}

export function normalizeChatModelOverrideValue(
  override: ChatModelOverride | null | undefined,
  catalog: ModelCatalogEntry[],
): string {
  return resolveChatModelOverride(override, catalog).value;
}

export function resolveChatModelOverride(
  override: ChatModelOverride | null | undefined,
  catalog: ModelCatalogEntry[],
): ChatModelResolution {
  if (!override) {
    return { value: "", source: "empty", reason: "empty" };
  }
  const trimmed = override?.value.trim();
  if (!trimmed) {
    return { value: "", source: "empty", reason: "empty" };
  }
  if (override.kind === "qualified") {
    return { value: trimmed, source: "qualified" };
  }

  let matchedValue = "";
  const normalizedTrimmed = normalizeLowercaseStringOrEmpty(trimmed);
  for (const entry of catalog) {
    if (normalizeLowercaseStringOrEmpty(entry.id) !== normalizedTrimmed) {
      continue;
    }
    const candidate = buildQualifiedChatModelValue(entry.id, entry.provider);
    if (!matchedValue) {
      matchedValue = candidate;
      continue;
    }
    if (
      normalizeLowercaseStringOrEmpty(matchedValue) !== normalizeLowercaseStringOrEmpty(candidate)
    ) {
      return { value: trimmed, source: "raw", reason: "ambiguous" };
    }
  }
  if (matchedValue) {
    return { value: matchedValue, source: "catalog" };
  }
  return { value: trimmed, source: "raw", reason: "missing" };
}

export function resolveServerChatModelValue(
  model?: string | null,
  provider?: string | null,
): string {
  if (typeof model !== "string") {
    return "";
  }
  return buildQualifiedChatModelValue(model, provider);
}

function resolveCatalogValueById(
  model: string,
  provider: string | null | undefined,
  catalog: ModelCatalogEntry[],
): ChatModelResolution | null {
  const trimmedModel = model.trim();
  const trimmedProvider = provider?.trim();
  if (!trimmedModel) {
    return null;
  }

  let providerMatch = "";
  let uniqueMatch = "";
  let matchCount = 0;
  for (const entry of catalog) {
    const entryId = entry.id.trim();
    if (entryId.toLowerCase() !== trimmedModel.toLowerCase()) {
      continue;
    }
    matchCount += 1;
    const candidate = buildQualifiedChatModelValue(entryId, entry.provider);
    if (trimmedProvider && entry.provider?.trim().toLowerCase() === trimmedProvider.toLowerCase()) {
      providerMatch = candidate;
    }
    if (!uniqueMatch) {
      uniqueMatch = candidate;
      continue;
    }
    if (uniqueMatch.toLowerCase() !== candidate.toLowerCase()) {
      uniqueMatch = "";
    }
  }

  if (providerMatch) {
    if (matchCount > 1) {
      return {
        value: buildQualifiedChatModelValue(trimmedModel, trimmedProvider),
        source: "server",
        reason: "ambiguous",
      };
    }
    return { value: providerMatch, source: "catalog" };
  }
  if (uniqueMatch) {
    return { value: uniqueMatch, source: "catalog" };
  }
  return null;
}

export function resolvePreferredServerChatModel(
  model: string | null | undefined,
  provider: string | null | undefined,
  catalog: ModelCatalogEntry[],
): ChatModelResolution {
  if (typeof model !== "string") {
    return { value: "", source: "empty", reason: "empty" };
  }
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    return { value: "", source: "empty", reason: "empty" };
  }

  const trimmedProvider = provider?.trim();
  if (
    trimmedProvider &&
    trimmedModel.toLowerCase().startsWith(`${trimmedProvider.toLowerCase()}/`)
  ) {
    return { value: trimmedModel, source: "qualified" };
  }

  const catalogResolution = resolveCatalogValueById(trimmedModel, trimmedProvider, catalog);
  if (catalogResolution) {
    return catalogResolution;
  }

  const overrideResolution = resolveChatModelOverride(
    createChatModelOverride(trimmedModel),
    catalog,
  );
  if (overrideResolution.source === "qualified" || overrideResolution.source === "catalog") {
    return overrideResolution;
  }

  return {
    value: resolveServerChatModelValue(trimmedModel, provider),
    source: "server",
    reason: overrideResolution.reason,
  };
}

export function resolvePreferredServerChatModelValue(
  model: string | null | undefined,
  provider: string | null | undefined,
  catalog: ModelCatalogEntry[],
): string {
  return resolvePreferredServerChatModel(model, provider, catalog).value;
}

export function formatChatModelDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const separator = trimmed.indexOf("/");
  if (separator <= 0) {
    return trimmed;
  }
  return `${trimmed.slice(separator + 1)} · ${trimmed.slice(0, separator)}`;
}

export function buildChatModelOption(entry: ModelCatalogEntry): { value: string; label: string } {
  const provider = entry.provider?.trim();
  return {
    value: buildQualifiedChatModelValue(entry.id, provider),
    label: provider ? `${entry.id} · ${provider}` : entry.id,
  };
}
