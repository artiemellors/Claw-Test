import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import {
  resolveEffectiveToolFsRootExpansionAllowed,
  resolveToolFsConfig,
} from "../agents/tool-fs-policy.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { safeFileURLToPath } from "../infra/local-file-access.js";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { resolveConfigDir, resolveUserPath } from "../utils.js";

type BuildMediaLocalRootsOptions = {
  preferredTmpDir?: string;
};

type AgentScopedMediaRootsOptions = {
  ignoreConfiguredRoots?: boolean;
};

let cachedPreferredTmpDir: string | undefined;
const HTTP_URL_RE = /^https?:\/\//i;
const DATA_URL_RE = /^data:/i;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;

function resolveCachedPreferredTmpDir(): string {
  if (!cachedPreferredTmpDir) {
    cachedPreferredTmpDir = resolvePreferredOpenClawTmpDir();
  }
  return cachedPreferredTmpDir;
}

export function buildMediaLocalRoots(
  stateDir: string,
  configDir: string,
  options: BuildMediaLocalRootsOptions = {},
): string[] {
  const resolvedStateDir = path.resolve(stateDir);
  const resolvedConfigDir = path.resolve(configDir);
  const preferredTmpDir = options.preferredTmpDir ?? resolveCachedPreferredTmpDir();
  return Array.from(
    new Set([
      preferredTmpDir,
      path.join(resolvedStateDir, "media"),
      path.join(resolvedStateDir, "workspace"),
      path.join(resolvedStateDir, "sandboxes"),
      // Upgraded installs can still resolve the active state dir to the legacy
      // ~/.clawdbot tree while new media writes already go under ~/.openclaw/media.
      // Keep inbound media readable across that split without widening roots beyond
      // the managed media cache.
      path.join(resolvedConfigDir, "media"),
    ]),
  );
}

export function getDefaultMediaLocalRoots(): readonly string[] {
  return buildMediaLocalRoots(resolveStateDir(), resolveConfigDir());
}

function getAgentScopedMediaLocalRootsInternal(
  cfg: OpenClawConfig,
  agentId?: string,
  options?: AgentScopedMediaRootsOptions,
): readonly string[] {
  const fsConfig = resolveToolFsConfig({ cfg, agentId });
  if (!options?.ignoreConfiguredRoots && fsConfig.roots !== undefined) {
    return fsConfig.roots.map((root) => path.resolve(root.path));
  }
  const roots = buildMediaLocalRoots(resolveStateDir(), resolveConfigDir());
  const normalizedAgentId = normalizeOptionalString(agentId);
  if (!normalizedAgentId) {
    return roots;
  }
  const workspaceDir = resolveAgentWorkspaceDir(cfg, normalizedAgentId);
  if (!workspaceDir) {
    return roots;
  }
  const normalizedWorkspaceDir = path.resolve(workspaceDir);
  if (!roots.includes(normalizedWorkspaceDir)) {
    roots.push(normalizedWorkspaceDir);
  }
  return roots;
}

export function getAgentScopedMediaLocalRoots(
  cfg: OpenClawConfig,
  agentId?: string,
): readonly string[] {
  return getAgentScopedMediaLocalRootsInternal(cfg, agentId);
}

function resolveLocalMediaPath(source: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed || HTTP_URL_RE.test(trimmed) || DATA_URL_RE.test(trimmed)) {
    return undefined;
  }
  if (trimmed.startsWith("file://")) {
    try {
      return safeFileURLToPath(trimmed);
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith("~")) {
    return resolveUserPath(trimmed);
  }
  if (path.isAbsolute(trimmed) || WINDOWS_DRIVE_RE.test(trimmed)) {
    return path.resolve(trimmed);
  }
  return undefined;
}

export function appendLocalMediaParentRoots(
  roots: readonly string[],
  mediaSources?: readonly string[],
): string[] {
  const appended = Array.from(new Set(roots.map((root) => path.resolve(root))));
  for (const source of mediaSources ?? []) {
    const localPath = resolveLocalMediaPath(source);
    if (!localPath) {
      continue;
    }
    const parentDir = path.dirname(localPath);
    if (parentDir === path.parse(parentDir).root) {
      continue;
    }
    const normalizedParent = path.resolve(parentDir);
    if (!appended.includes(normalizedParent)) {
      appended.push(normalizedParent);
    }
  }
  return appended;
}

export function getAgentScopedMediaLocalRootsForSources(params: {
  cfg: OpenClawConfig;
  agentId?: string;
  mediaSources?: readonly string[];
  ignoreConfiguredRoots?: boolean;
}): readonly string[] {
  const fsConfig = resolveToolFsConfig({ cfg: params.cfg, agentId: params.agentId });
  const roots = getAgentScopedMediaLocalRootsInternal(params.cfg, params.agentId, {
    ignoreConfiguredRoots: params.ignoreConfiguredRoots,
  });
  if (fsConfig.roots !== undefined && !params.ignoreConfiguredRoots) {
    return roots;
  }
  const fallbackRoots = [...roots];
  if (fsConfig.workspaceOnly) {
    return fallbackRoots;
  }
  if (!resolveEffectiveToolFsRootExpansionAllowed({ cfg: params.cfg, agentId: params.agentId })) {
    return fallbackRoots;
  }
  return appendLocalMediaParentRoots(fallbackRoots, params.mediaSources);
}
