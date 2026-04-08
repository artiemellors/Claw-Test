import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { normalizeProviderId } from "../agents/provider-id.js";
import { loadPluginManifest } from "./manifest.js";
import { resolveBundledPluginsDir } from "./bundled-dir.js";

type SetupRegistryRuntimeModule = Pick<
  typeof import("./setup-registry.js"),
  "resolvePluginSetupCliBackend"
>;

type SetupCliBackendRuntimeEntry = {
  pluginId: string;
  backend: {
    id: string;
  };
};

const require = createRequire(import.meta.url);
const SETUP_REGISTRY_RUNTIME_CANDIDATES = ["./setup-registry.js", "./setup-registry.ts"] as const;

let setupRegistryRuntimeModule: SetupRegistryRuntimeModule | undefined;

let bundledSetupCliBackendsCacheKey: string | undefined;
let bundledSetupCliBackendsCache: readonly SetupCliBackendRuntimeEntry[] | undefined;

function resolveBundledSetupCliBackends(
  env: NodeJS.ProcessEnv = process.env,
): readonly SetupCliBackendRuntimeEntry[] {
  const bundledPluginsDir = resolveBundledPluginsDir(env);
  const cacheKey = bundledPluginsDir ? path.resolve(bundledPluginsDir) : "";
  if (bundledSetupCliBackendsCache && bundledSetupCliBackendsCacheKey === cacheKey) {
    return bundledSetupCliBackendsCache;
  }
  if (!bundledPluginsDir || !fs.existsSync(bundledPluginsDir)) {
    bundledSetupCliBackendsCacheKey = cacheKey;
    bundledSetupCliBackendsCache = [];
    return bundledSetupCliBackendsCache;
  }

  const entries = fs
    .readdirSync(bundledPluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const pluginDir = path.join(bundledPluginsDir, entry.name);
      const manifestResult = loadPluginManifest(pluginDir, false);
      if (!manifestResult.ok) {
        return [];
      }
      return (manifestResult.manifest.cliBackends ?? []).map(
        (backendId) =>
          ({
            pluginId: manifestResult.manifest.id,
            backend: { id: backendId },
          }) satisfies SetupCliBackendRuntimeEntry,
      );
    });

  bundledSetupCliBackendsCacheKey = cacheKey;
  bundledSetupCliBackendsCache = entries;
  return bundledSetupCliBackendsCache;
}

function loadSetupRegistryRuntime(): SetupRegistryRuntimeModule | null {
  if (setupRegistryRuntimeModule) {
    return setupRegistryRuntimeModule;
  }
  for (const candidate of SETUP_REGISTRY_RUNTIME_CANDIDATES) {
    try {
      setupRegistryRuntimeModule = require(candidate) as SetupRegistryRuntimeModule;
      return setupRegistryRuntimeModule;
    } catch {
      // Try source/runtime candidates in order.
    }
  }
  return null;
}

export function resolvePluginSetupCliBackendRuntime(params: { backend: string }) {
  const runtime = loadSetupRegistryRuntime();
  if (runtime) {
    return runtime.resolvePluginSetupCliBackend(params);
  }
  const normalized = normalizeProviderId(params.backend);
  return resolveBundledSetupCliBackends().find(
    (entry) => normalizeProviderId(entry.backend.id) === normalized,
  );
}
