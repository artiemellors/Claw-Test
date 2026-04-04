import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

export const BAILIAN_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export const BAILIAN_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export const BAILIAN_MODEL_CATALOG: ReadonlyArray<ModelDefinitionConfig> = [
  {
    id: "qwen3-coder-plus",
    name: "qwen3-coder-plus",
    reasoning: false,
    input: ["text"],
    cost: BAILIAN_DEFAULT_COST,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    compat: { supportsUsageInStreaming: true },
  },
  {
    id: "qwen3.5-plus",
    name: "qwen3.5-plus",
    reasoning: false,
    input: ["text", "image"],
    cost: BAILIAN_DEFAULT_COST,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    compat: { supportsUsageInStreaming: true },
  },
  {
    id: "qwen3.6-plus",
    name: "qwen3.6-plus",
    reasoning: false,
    input: ["text", "image"],
    cost: BAILIAN_DEFAULT_COST,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    compat: { supportsUsageInStreaming: true },
  },
];

export const BAILIAN_DEFAULT_MODEL_ID = "qwen3-coder-plus";
export const BAILIAN_DEFAULT_MODEL_REF = `bailian/${BAILIAN_DEFAULT_MODEL_ID}`;

export function buildBailianModelDefinition(model: ModelDefinitionConfig): ModelDefinitionConfig {
  return {
    ...model,
    api: "openai-completions",
  };
}
