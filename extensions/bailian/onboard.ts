import {
  applyAgentDefaultModelPrimary,
  applyProviderConfigWithModelCatalog,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import { BAILIAN_BASE_URL, BAILIAN_MODEL_CATALOG, buildBailianModelDefinition } from "./api.js";
import { BAILIAN_DEFAULT_MODEL_REF } from "./models.js";

export { BAILIAN_DEFAULT_MODEL_REF };

export function applyBailianProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  const models = { ...cfg.agents?.defaults?.models };
  return applyProviderConfigWithModelCatalog(cfg, {
    agentModels: models,
    providerId: "bailian",
    api: "openai-completions",
    baseUrl: BAILIAN_BASE_URL,
    catalogModels: BAILIAN_MODEL_CATALOG.map(buildBailianModelDefinition),
  });
}

export function applyBailianConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(applyBailianProviderConfig(cfg), BAILIAN_DEFAULT_MODEL_REF);
}
