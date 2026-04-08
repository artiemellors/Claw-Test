import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  cleanupPluginLoaderFixturesForTest,
  EMPTY_PLUGIN_SCHEMA,
  makeTempDir,
  resetPluginLoaderTestStateForTest,
  writePlugin,
} from "../plugins/loader.test-fixtures.js";
import { isPluginLoadableAndEnabled } from "./provider-onboard.js";

function simplePluginBody(id: string) {
  return `module.exports = { id: ${JSON.stringify(id)}, register() {} };`;
}

function writeBundledPlugin(id: string) {
  const bundledDir = makeTempDir();
  const plugin = writePlugin({
    id,
    dir: bundledDir,
    filename: `${id}.cjs`,
    body: simplePluginBody(id),
  });
  fs.writeFileSync(
    path.join(plugin.dir, "openclaw.plugin.json"),
    JSON.stringify(
      {
        id,
        enabledByDefault: true,
        configSchema: EMPTY_PLUGIN_SCHEMA,
      },
      null,
      2,
    ),
    "utf-8",
  );
  process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledDir;
}

describe("isPluginLoadableAndEnabled", () => {
  afterEach(() => {
    resetPluginLoaderTestStateForTest();
  });

  afterAll(() => {
    cleanupPluginLoaderFixturesForTest();
  });

  it("returns false when no matching plugin record exists", () => {
    expect(isPluginLoadableAndEnabled({}, "missing")).toBe(false);
  });

  it("returns false when a disabled higher-precedence duplicate wins", () => {
    writeBundledPlugin("acpx");
    const shadow = writePlugin({
      id: "acpx",
      filename: "index.cjs",
      body: simplePluginBody("acpx"),
    });

    expect(
      isPluginLoadableAndEnabled(
        {
          plugins: {
            load: { paths: [shadow.file] },
            entries: {
              acpx: { enabled: false },
            },
          },
        },
        "acpx",
      ),
    ).toBe(false);
  });

  it("returns true when an enabled higher-precedence duplicate wins", () => {
    writeBundledPlugin("acpx");
    const shadow = writePlugin({
      id: "acpx",
      filename: "index.cjs",
      body: simplePluginBody("acpx"),
    });

    expect(
      isPluginLoadableAndEnabled(
        {
          plugins: {
            load: { paths: [shadow.file] },
          },
        },
        "acpx",
      ),
    ).toBe(true);
  });
});
