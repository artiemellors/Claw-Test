import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth";
import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import {
  createDeepInfraSystemCacheWrapper,
  createDeepInfraWrapper,
  isProxyReasoningUnsupported,
} from "openclaw/plugin-sdk/provider-stream";
import { applyDeepInfraConfig, DEEPINFRA_DEFAULT_MODEL_REF } from "./onboard.js";
import { buildDeepInfraProviderWithDiscovery } from "./provider-catalog.js";

const PROVIDER_ID = "deepinfra";

// Synthetic browse-only key used when no real DEEPINFRA_API_KEY is set.
// DeepInfra's /models endpoint is free (no auth needed), so the catalog
// should always be populated for browsing. The upstream ModelRegistry
// requires an apiKey to accept models, so this marker satisfies that
// constraint while signalling that inference requires a real key.
const DEEPINFRA_BROWSE_KEY = "deepinfra-browse";

const DEEPINFRA_CACHE_TTL_MODEL_PREFIXES = [
  "anthropic/",
  "moonshot/",
  "moonshotai/",
  "zai/",
  "zai-org/",
] as const;

async function runCatalog(ctx: ProviderCatalogContext) {
  const apiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
  const provider = await buildDeepInfraProviderWithDiscovery();
  return {
    provider: {
      ...provider,
      apiKey: apiKey || DEEPINFRA_BROWSE_KEY,
    },
  };
}

export default definePluginEntry({
  id: PROVIDER_ID,
  name: "DeepInfra Provider",
  description: "Bundled DeepInfra provider plugin",
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "DeepInfra",
      docsPath: "/providers/deepinfra",
      auth: [
        createProviderApiKeyAuthMethod({
          methodId: "api-key",
          label: "DeepInfra API key",
          hint: "Unified API for open source models",
          optionKey: "deepinfraApiKey",
          flagName: "--deepinfra-api-key",
          envVar: "DEEPINFRA_API_KEY",
          promptMessage: "Enter DeepInfra API key",
          defaultModel: DEEPINFRA_DEFAULT_MODEL_REF,
          providerId: PROVIDER_ID,
          expectedProviders: [PROVIDER_ID],
          applyConfig: (cfg) => applyDeepInfraConfig(cfg),
          wizard: {
            choiceId: "deepinfra-api-key",
            choiceLabel: "DeepInfra API key",
            choiceHint: "Unified API for open source models",
            groupId: PROVIDER_ID,
            groupLabel: "DeepInfra",
            groupHint: "Unified API for open source models",
            methodId: "api-key",
          },
        }),
      ],
      catalog: {
        order: "simple",
        run: runCatalog,
      },
      capabilities: {
        openAiCompatTurnValidation: false,
        geminiThoughtSignatureSanitization: true,
        geminiThoughtSignatureModelHints: ["gemini"],
        dropThinkingBlockModelHints: ["claude"],
      },
      wrapStreamFn: (ctx) => {
        const thinkingLevel = isProxyReasoningUnsupported(ctx.modelId)
          ? undefined
          : ctx.thinkingLevel;
        let streamFn = createDeepInfraWrapper(ctx.streamFn, thinkingLevel);
        streamFn = createDeepInfraSystemCacheWrapper(streamFn);
        return streamFn;
      },
      isCacheTtlEligible: (ctx) =>
        DEEPINFRA_CACHE_TTL_MODEL_PREFIXES.some((p) => ctx.modelId.startsWith(p)),
      // DeepInfra's model discovery API is free (no key needed), so always
      // provide a synthetic browse key to ensure the catalog runs and models
      // are visible even before the user configures a real API key.
      resolveSyntheticAuth: () => ({
        apiKey: DEEPINFRA_BROWSE_KEY,
        source: "deepinfra (synthetic browse key)",
        mode: "api-key" as const,
      }),
    });
  },
});
