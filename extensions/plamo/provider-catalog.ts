import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-models";
import { buildPlamoCatalogModels, PLAMO_BASE_URL } from "./model-definitions.js";

export function buildPlamoProvider(): ModelProviderConfig {
  return {
    baseUrl: PLAMO_BASE_URL,
    api: "openai-completions",
    models: buildPlamoCatalogModels(),
  };
}
