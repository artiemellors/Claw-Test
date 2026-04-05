import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import { BAILIAN_BASE_URL, BAILIAN_MODEL_CATALOG, buildBailianModelDefinition } from "./api.js";

export function buildBailianProvider(): ModelProviderConfig {
  return {
    baseUrl: BAILIAN_BASE_URL,
    api: "openai-completions",
    models: BAILIAN_MODEL_CATALOG.map(buildBailianModelDefinition),
  };
}
