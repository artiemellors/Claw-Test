import { describe, expect, it } from "vitest";
import { bundledPluginRoot } from "../../test/helpers/bundled-plugin-paths.js";
import tsdownConfig from "../../tsdown.config.ts";

type TsdownConfigEntry = {
  deps?: {
    neverBundle?: string[];
  };
  entry?: Record<string, string> | string[];
  outDir?: string;
  outputOptions?: (options: unknown) => {
    chunkFileNames?: (chunkInfo: { name: string; moduleIds: string[] }) => string;
  };
};

function asConfigArray(config: unknown): TsdownConfigEntry[] {
  return Array.isArray(config) ? (config as TsdownConfigEntry[]) : [config as TsdownConfigEntry];
}

function entryKeys(config: TsdownConfigEntry): string[] {
  if (!config.entry || Array.isArray(config.entry)) {
    return [];
  }
  return Object.keys(config.entry);
}

function bundledEntry(pluginId: string): string {
  return `${bundledPluginRoot(pluginId)}/index`;
}

describe("tsdown config", () => {
  it("keeps core, plugin runtime, plugin-sdk, bundled plugins, and bundled hooks in one dist graph", () => {
    const configs = asConfigArray(tsdownConfig);
    const distGraphs = configs.filter((config) => {
      const keys = entryKeys(config);
      return (
        keys.includes("index") ||
        keys.includes("plugins/runtime/index") ||
        keys.includes("plugin-sdk/index") ||
        keys.includes(bundledEntry("openai")) ||
        keys.includes("bundled/boot-md/handler")
      );
    });

    expect(distGraphs).toHaveLength(1);
    expect(entryKeys(distGraphs[0])).toEqual(
      expect.arrayContaining([
        "agents/auth-profiles.runtime",
        "agents/model-catalog.runtime",
        "agents/models-config.runtime",
        "agents/pi-model-discovery-runtime",
        "index",
        "commands/status.summary.runtime",
        "plugins/provider-discovery.runtime",
        "plugins/provider-runtime.runtime",
        "plugins/runtime/index",
        "plugin-sdk/compat",
        "plugin-sdk/index",
        bundledEntry("openai"),
        bundledEntry("matrix"),
        bundledEntry("msteams"),
        bundledEntry("whatsapp"),
        "bundled/boot-md/handler",
      ]),
    );
  });

  it("does not emit plugin-sdk or hooks from a separate dist graph", () => {
    const configs = asConfigArray(tsdownConfig);

    expect(configs.some((config) => config.outDir === "dist/plugin-sdk")).toBe(false);
    expect(
      configs.some((config) =>
        Array.isArray(config.entry)
          ? config.entry.some((entry) => entry.includes("src/hooks/"))
          : false,
      ),
    ).toBe(false);
  });

  it("externalizes staged bundled plugin runtime dependencies", () => {
    const configs = asConfigArray(tsdownConfig);
    const unifiedGraph = configs.find((config) => entryKeys(config).includes("index"));

    expect(unifiedGraph?.deps?.neverBundle).toEqual(expect.arrayContaining(["silk-wasm", "ws"]));
  });

  it("routes bundled plugin shared chunks to their own directory", () => {
    const configs = asConfigArray(tsdownConfig);
    const unifiedGraph = configs.find((config) => entryKeys(config).includes("index"));
    expect(unifiedGraph).toBeDefined();

    // Extract the chunkFileNames function from outputOptions
    const outputOptionsFn = unifiedGraph!.outputOptions;
    expect(typeof outputOptionsFn).toBe("function");

    const outputOptions = outputOptionsFn!({});
    const chunkFileNames = outputOptions.chunkFileNames!;
    expect(typeof chunkFileNames).toBe("function");

    // Scenario 1: A chunk containing only slack files
    expect(
      chunkFileNames({
        name: "shared-slack-api",
        moduleIds: [
          "extensions/slack/src/api.ts",
          "extensions/slack/src/token.ts",
        ],
      }),
    ).toBe("extensions/slack/[name]-[hash].js");

    // Scenario 2: A chunk containing only telegram files
    expect(
      chunkFileNames({
        name: "shared-telegram-api",
        moduleIds: [
          "extensions/telegram/src/api.ts",
          "extensions/telegram/src/config.ts",
        ],
      }),
    ).toBe("extensions/telegram/[name]-[hash].js");

    // Scenario 3: A chunk containing mixed files (architectural violation)
    expect(
      chunkFileNames({
        name: "shared-mixed",
        moduleIds: [
          "extensions/slack/src/api.ts",
          "extensions/telegram/src/api.ts",
        ],
      }),
    ).toBe("[name]-[hash].js");

    // Scenario 4: A chunk containing only core files
    expect(
      chunkFileNames({
        name: "shared-core",
        moduleIds: [
          "src/gateway/server-http.ts",
          "src/gateway/client.ts",
        ],
      }),
    ).toBe("[name]-[hash].js");

    // Scenario 5: A chunk containing plugin and core files
    expect(
      chunkFileNames({
        name: "shared-plugin-and-core",
        moduleIds: [
          "extensions/slack/src/api.ts",
          "src/gateway/server-http.ts",
        ],
      }),
    ).toBe("[name]-[hash].js");

    // Scenario 5b: A chunk containing plugin files and virtual modules
    expect(
      chunkFileNames({
        name: "shared-plugin-with-virtual",
        moduleIds: [
          "extensions/slack/src/api.ts",
          "\0commonjsHelpers.js",
        ],
      }),
    ).toBe("extensions/slack/[name]-[hash].js");

    // Scenario 5c: A chunk containing plugin files and node_modules dependencies
    expect(
      chunkFileNames({
        name: "shared-plugin-with-deps",
        moduleIds: [
          "extensions/slack/src/api.ts",
          "node_modules/@slack/web-api/index.js",
        ],
      }),
    ).toBe("extensions/slack/[name]-[hash].js");

    // Scenario 6: Fallback to previous function
    const outputOptionsWithFn = outputOptionsFn!({
      chunkFileNames: () => "custom-fn-[hash].js",
    });
    expect(
      outputOptionsWithFn.chunkFileNames!({
        name: "shared-core",
        moduleIds: ["src/gateway/server-http.ts"],
      }),
    ).toBe("custom-fn-[hash].js");

    // Scenario 7: Fallback to previous string
    const outputOptionsWithStr = outputOptionsFn!({
      chunkFileNames: "custom-str-[hash].js",
    });
    expect(
      outputOptionsWithStr.chunkFileNames!({
        name: "shared-core",
        moduleIds: ["src/gateway/server-http.ts"],
      }),
    ).toBe("custom-str-[hash].js");
  });
});
