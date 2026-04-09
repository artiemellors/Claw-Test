import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import JSON5 from "json5";
import { normalizeProviderId } from "../agents/provider-id.js";
import { openBoundaryFileSync } from "../infra/boundary-file-read.js";
import { loadPluginManifest, resolvePluginManifestPath } from "./manifest.js";
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

function resolveManifestOnlyCliBackends(pluginDir: string): SetupCliBackendRuntimeEntry[] {
  const manifestPath = resolvePluginManifestPath(pluginDir);
  const opened = openBoundaryFileSync({
    absolutePath: manifestPath,
    rootPath: pluginDir,
    boundaryLabel: "plugin root",
    rejectHardlinks: true,
    maxBytes: 1024 * 1024,
  });
  if (!opened.ok) {
    return [];
  }
  try {
    const raw = JSON5.parse(fs.readFileSync(opened.fd, "utf8")) as {
      id?: unknown;
      cliBackends?: unknown;
    };
    const pluginId = typeof raw?.id === "string" ? raw.id.trim() : "";
    const cliBackends = Array.isArray(raw?.cliBackends)
      ? raw.cliBackends
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      : [];
    if (!pluginId || cliBackends.length === 0) {
      return [];
    }
    return cliBackends.map(
      (backendId) =>
        ({
          pluginId,
          backend: { id: backendId },
        }) satisfies SetupCliBackendRuntimeEntry,
    );
  } catch {
    return [];
  } finally {
    fs.closeSync(opened.fd);
  }
}

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

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(bundledPluginsDir, { withFileTypes: true });
  } catch {
    bundledSetupCliBackendsCacheKey = cacheKey;
    bundledSetupCliBackendsCache = [];
    return bundledSetupCliBackendsCache;
  }

  const entries = dirEntries.filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const pluginDir = path.join(bundledPluginsDir, entry.name);
    const manifestResult = loadPluginManifest(pluginDir, false);
    if (manifestResult.ok) {
      return (manifestResult.manifest.cliBackends ?? []).map(
        (backendId) =>
          ({
            pluginId: manifestResult.manifest.id,
            backend: { id: backendId },
          }) satisfies SetupCliBackendRuntimeEntry,
      );
    }
    return resolveManifestOnlyCliBackends(pluginDir);
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
