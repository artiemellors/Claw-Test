import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolvePathFromInput } from "../agents/path-policy.js";
import {
  resolveEffectiveToolFsRootExpansionAllowed,
  resolveToolFsConfig,
} from "../agents/tool-fs-policy.js";
import { resolveWorkspaceRoot } from "../agents/workspace-dir.js";
import type { OpenClawConfig } from "../config/config.js";
import { readLocalFileSafely } from "../infra/fs-safe.js";
import type { OutboundMediaAccess, OutboundMediaReadFile } from "./load-options.js";
import { getAgentScopedMediaLocalRootsForSources } from "./local-roots.js";

export function createAgentScopedHostMediaReadFile(params: {
  cfg: OpenClawConfig;
  agentId?: string;
  workspaceDir?: string;
}): OutboundMediaReadFile | undefined {
  // When tools.fs.roots is configured, do not attach an unrestricted host
  // readFile capability — it would cause buildOutboundMediaLoadOptions to
  // set localRoots: "any", bypassing the configured root restrictions.
  // The media loader falls through to the localRoots-based path checking.
  const fsConfig = resolveToolFsConfig({ cfg: params.cfg, agentId: params.agentId });
  if (fsConfig.roots !== undefined) {
    return undefined;
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
    });
  return {
    ...(localRoots !== undefined ? { localRoots } : {}),
    ...(readFile ? { readFile } : {}),
    ...(resolvedWorkspaceDir ? { workspaceDir: resolvedWorkspaceDir } : {}),
  };
}
