import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "openclaw/plugin-sdk/provider-onboard";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupPluginLoaderFixturesForTest,
  resetPluginLoaderTestStateForTest,
  writePlugin,
} from "../../src/plugins/loader.test-fixtures.js";
import {
  createConfigWithFallbacks,
  EXPECTED_FALLBACKS,
} from "../../test/helpers/plugins/onboard-config.js";

async function loadOnboardModule() {
  return import("./onboard.js");
}

function simplePluginBody(id: string) {
  return `module.exports = { id: ${JSON.stringify(id)}, register() {} };`;
}

describe("plamo onboard", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("openclaw/plugin-sdk/provider-onboard");
    resetPluginLoaderTestStateForTest();
  });

  afterAll(() => {
    cleanupPluginLoaderFixturesForTest();
  });

  it("adds the PLaMo provider and defaults the ACP backend to acpx when available", async () => {
    const { applyPlamoConfig, PLAMO_DEFAULT_MODEL_REF } = await loadOnboardModule();
    const cfg = applyPlamoConfig({});

    expect(cfg.models?.providers?.plamo).toMatchObject({
      baseUrl: "https://api.platform.preferredai.jp/v1",
      api: "openai-completions",
    });
    expect(resolveAgentModelPrimaryValue(cfg.agents?.defaults?.model)).toBe(
      PLAMO_DEFAULT_MODEL_REF,
    );
    expect(cfg.acp?.backend).toBe("acpx");
  });

  it("preserves existing model fallbacks", async () => {
    const { applyPlamoConfig } = await loadOnboardModule();
    const cfg = applyPlamoConfig(createConfigWithFallbacks());
    expect(resolveAgentModelFallbackValues(cfg.agents?.defaults?.model)).toEqual([
      ...EXPECTED_FALLBACKS,
    ]);
  });

  it("does not force acpx when plugins.allow excludes it", async () => {
    const { applyPlamoConfig } = await loadOnboardModule();
    const cfg = applyPlamoConfig({
      plugins: {
        allow: ["plamo"],
      },
    });

    expect(cfg.acp?.backend).toBeUndefined();
  });

  it("does not force acpx when a higher-precedence acpx override is disabled", async () => {
    const shadow = writePlugin({
      id: "acpx",
      filename: "index.cjs",
      body: simplePluginBody("acpx"),
    });

    const { applyPlamoConfig } = await loadOnboardModule();
    const cfg = applyPlamoConfig({
      plugins: {
        load: { paths: [shadow.file] },
        entries: {
          acpx: { enabled: false },
        },
      },
    });

    expect(cfg.acp?.backend).toBeUndefined();
  });

  it("does not force acpx when the plugin is unavailable", async () => {
    vi.doMock("openclaw/plugin-sdk/provider-onboard", async (importActual) => {
      const actual = await importActual<typeof import("openclaw/plugin-sdk/provider-onboard")>();
      return {
        ...actual,
        isPluginLoadableAndEnabled: () => false,
      };
    });

    const { applyPlamoConfig } = await loadOnboardModule();
    const cfg = applyPlamoConfig({});

    expect(cfg.acp?.backend).toBeUndefined();
  });
});
