import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolvePathFromInput } from "../agents/path-policy.js";
import {
  resolveEffectiveToolFsRootExpansionAllowed,
  resolveToolFsConfig,
} from "../agents/tool-fs-policy.js";
import { resolveWorkspaceRoot } from "../agents/workspace-dir.js";
import type { OpenClawConfig } from "../config/config.js";
import type { FsRoot } from "../config/types.tools.js";
import { readLocalFileSafely, readPathWithinRoot } from "../infra/fs-safe.js";
import type { OutboundMediaAccess, OutboundMediaReadFile } from "./load-options.js";
import { getAgentScopedMediaLocalRootsForSources } from "./local-roots.js";

export function createAgentScopedHostMediaReadFile(params: {
  cfg: OpenClawConfig;
  agentId?: string;
  workspaceDir?: string;
  ignoreConfiguredRoots?: boolean;
}): OutboundMediaReadFile | undefined {
  if (!params.ignoreConfiguredRoots) {
    const fsConfig = resolveToolFsConfig({ cfg: params.cfg, agentId: params.agentId });
    // When tools.fs.roots is configured, return a root-scoped readFile that
    // only allows reads inside the configured roots. This keeps hostReadCapability
    // active (so assertHostReadMediaAllowed still runs) while enforcing roots.
    if (fsConfig.roots !== undefined) {
      if (fsConfig.roots.length === 0) {
        return undefined; // deny-all — no reads allowed
      }
      return createRootScopedReadFile(fsConfig.roots, params.workspaceDir);
    }
  }
  if (
    !resolveEffectiveToolFsRootExpansionAllowed({
      cfg: params.cfg,
      agentId: params.agentId,
    })
  ) {
    return undefined;
  }
  const inferredWorkspaceDir =
    params.workspaceDir ??
    (params.agentId ? resolveAgentWorkspaceDir(params.cfg, params.agentId) : undefined);
  const workspaceRoot = resolveWorkspaceRoot(inferredWorkspaceDir);
  return async (filePath: string) => {
    const resolvedPath = resolvePathFromInput(filePath, workspaceRoot);
    return (await readLocalFileSafely({ filePath: resolvedPath })).buffer;
  };
}

function createRootScopedReadFile(roots: FsRoot[], workspaceDir?: string): OutboundMediaReadFile {
  const workspaceRoot = resolveWorkspaceRoot(workspaceDir);
  return async (filePath: string) => {
    const resolvedPath = path.resolve(resolvePathFromInput(filePath, workspaceRoot));
    // Try each configured root — use readPathWithinRoot for dir roots (alias-safe,
    // validates canonical path after symlink resolution) and exact match for file roots.
    for (const root of roots) {
      const rootPath = path.resolve(root.path);
      if (root.kind === "file") {
        if (resolvedPath === rootPath) {
          return (await readLocalFileSafely({ filePath: resolvedPath })).buffer;
        }
        continue;
      }
      // For dir roots, readPathWithinRoot enforces the boundary on the canonical
      // path (after symlink resolution), preventing symlink traversal escapes.
      try {
        const result = await readPathWithinRoot({ rootDir: rootPath, filePath: resolvedPath });
        return result.buffer;
      } catch {
        continue; // not inside this root — try next
      }
    }
    throw new Error(
      `Access denied: media path '${filePath}' is outside configured filesystem roots`,
    );
  };
}

export function resolveAgentScopedOutboundMediaAccess(params: {
  cfg: OpenClawConfig;
  agentId?: string;
  mediaSources?: readonly string[];
  workspaceDir?: string;
  mediaAccess?: OutboundMediaAccess;
  mediaReadFile?: OutboundMediaReadFile;
  ignoreConfiguredRoots?: boolean;
}): OutboundMediaAccess {
  const localRoots =
    params.mediaAccess?.localRoots ??
    getAgentScopedMediaLocalRootsForSources({
      cfg: params.cfg,
      agentId: params.agentId,
      mediaSources: params.mediaSources,
      ignoreConfiguredRoots: params.ignoreConfiguredRoots,
    });
  const resolvedWorkspaceDir =
    params.workspaceDir ??
    params.mediaAccess?.workspaceDir ??
    (params.agentId ? resolveAgentWorkspaceDir(params.cfg, params.agentId) : undefined);
  const readFile =
    params.mediaAccess?.readFile ??
    params.mediaReadFile ??
    createAgentScopedHostMediaReadFile({
      cfg: params.cfg,
      agentId: params.agentId,
      workspaceDir: resolvedWorkspaceDir,
      ignoreConfiguredRoots: params.ignoreConfiguredRoots,
    });
  return {
    ...(localRoots !== undefined ? { localRoots } : {}),
    ...(readFile ? { readFile } : {}),
    ...(resolvedWorkspaceDir ? { workspaceDir: resolvedWorkspaceDir } : {}),
  };
}
