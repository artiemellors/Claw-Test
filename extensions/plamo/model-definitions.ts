import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-models";

export const PLAMO_BASE_URL = "https://api.platform.preferredai.jp/v1";
export const PLAMO_DEFAULT_MODEL_ID = "plamo-2.2-prime";
export const PLAMO_DEFAULT_MODEL_REF = `plamo/${PLAMO_DEFAULT_MODEL_ID}`;
export const PLAMO_DEFAULT_CONTEXT_WINDOW = 32_768;
export const PLAMO_DEFAULT_MAX_TOKENS = 8_192;

const PLAMO_MODEL_CATALOG = [
  {
    id: PLAMO_DEFAULT_MODEL_ID,
    name: "PLaMo 2.2 Prime",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: PLAMO_DEFAULT_CONTEXT_WINDOW,
    maxTokens: PLAMO_DEFAULT_MAX_TOKENS,
  },
] as const satisfies readonly ModelDefinitionConfig[];

export function buildPlamoCatalogModels(): ModelDefinitionConfig[] {
  return PLAMO_MODEL_CATALOG.map((model) => ({ ...model, input: [...model.input] }));
}
