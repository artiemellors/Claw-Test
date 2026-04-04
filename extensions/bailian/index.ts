import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { composeProviderStreamWrappers } from "openclaw/plugin-sdk/provider-stream";
import { applyBailianConfig, BAILIAN_DEFAULT_MODEL_REF } from "./onboard.js";
import { buildBailianProvider } from "./provider-catalog.js";
import { createBailianCacheControlWrapper } from "./stream-wrappers.js";

const PROVIDER_ID = "bailian";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "Bailian Provider",
  description: "Bundled Bailian (DashScope) provider plugin",
  provider: {
    label: "Bailian",
    docsPath: "/providers/bailian",
    auth: [
      {
        methodId: "api-key",
        label: "Bailian API key",
        hint: "API key",
        optionKey: "bailianApiKey",
        flagName: "--bailian-api-key",
        envVar: "BAILIAN_API_KEY",
        promptMessage: "Enter Bailian (DashScope) API key",
        defaultModel: BAILIAN_DEFAULT_MODEL_REF,
        applyConfig: (cfg) => applyBailianConfig(cfg),
        wizard: {
          choiceId: "bailian-api-key",
          choiceLabel: "Bailian API key",
          groupId: "bailian",
          groupLabel: "Bailian (DashScope)",
          groupHint: "API key",
        },
      },
    ],
    catalog: {
      buildProvider: buildBailianProvider,
    },
    wrapStreamFn: (ctx) =>
      composeProviderStreamWrappers(ctx.streamFn, createBailianCacheControlWrapper),
    isCacheTtlEligible: () => true,
  },
});
