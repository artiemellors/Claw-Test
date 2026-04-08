import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importFreshModule } from "../../test/helpers/import-fresh.ts";
import { cleanupTrackedTempDirs, makeTrackedTempDir } from "./test-helpers/fs-fixtures.js";

const tempDirs: string[] = [];
const originalBundledPluginsDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
const originalDisableBundledPlugins = process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS;

function createBundledPlugin(params: { bundledDir: string; dirName: string; pluginId: string; cliBackends: string[] }) {
  const pluginDir = path.join(params.bundledDir, params.dirName);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "package.json"),
    `${JSON.stringify({ name: `@openclaw/${params.pluginId}` }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(pluginDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: params.pluginId, cliBackends: params.cliBackends }, null, 2)}\n`,
    "utf8",
  );
}

afterEach(() => {
  cleanupTrackedTempDirs(tempDirs);
  vi.restoreAllMocks();
  vi.resetModules();
  if (originalBundledPluginsDir === undefined) {
    delete process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
  } else {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = originalBundledPluginsDir;
  }
  if (originalDisableBundledPlugins === undefined) {
    delete process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS;
  } else {
    process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS = originalDisableBundledPlugins;
  }
});

describe("resolvePluginSetupCliBackendRuntime fallback", () => {
  it("respects OPENCLAW_BUNDLED_PLUGINS_DIR overrides without loading setup runtime", async () => {
    const bundledDir = makeTrackedTempDir("openclaw-setup-registry-runtime", tempDirs);
    createBundledPlugin({
      bundledDir,
      dirName: "demo-provider",
      pluginId: "demo-provider",
      cliBackends: ["demo-backend"],
    });
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledDir;
    delete process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS;

    vi.doMock("node:module", async () => {
      const actual = await vi.importActual<typeof import("node:module")>("node:module");
      return {
        ...actual,
        createRequire: () => () => {
          throw new Error("force runtime fallback");
        },
      };
    });

    const runtime = await importFreshModule<typeof import("./setup-registry.runtime.js")>(
      import.meta.url,
      "./setup-registry.runtime.js?scope=fallback-env-aware",
    );

    expect(runtime.resolvePluginSetupCliBackendRuntime({ backend: "demo-backend" })).toEqual({
      pluginId: "demo-provider",
      backend: { id: "demo-backend" },
    });
  });

  it("treats disabled bundled plugins as unavailable in fallback mode", async () => {
    const bundledDir = makeTrackedTempDir("openclaw-setup-registry-disabled", tempDirs);
    createBundledPlugin({
      bundledDir,
      dirName: "demo-provider",
      pluginId: "demo-provider",
      cliBackends: ["demo-backend"],
    });
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledDir;
    process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS = "1";

    vi.doMock("node:module", async () => {
      const actual = await vi.importActual<typeof import("node:module")>("node:module");
      return {
        ...actual,
        createRequire: () => () => {
          throw new Error("force runtime fallback");
        },
      };
    });

    const runtime = await importFreshModule<typeof import("./setup-registry.runtime.js")>(
      import.meta.url,
      "./setup-registry.runtime.js?scope=fallback-disabled",
    );

    expect(runtime.resolvePluginSetupCliBackendRuntime({ backend: "demo-backend" })).toBeUndefined();
  });
});
