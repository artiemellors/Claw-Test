import type { SkillSnapshot } from "../../agents/skills.js";
import { canReuseSkillSnapshot } from "../../agents/skills/snapshot-cache.js";
import type { OpenClawConfig } from "../../config/config.js";
import {
  buildWorkspaceSkillSnapshot,
  getRemoteSkillEligibility,
  getSkillsSnapshotVersion,
  resolveAgentSkillsFilter,
} from "./run.runtime.js";

export function resolveCronSkillsSnapshot(params: {
  workspaceDir: string;
  config: OpenClawConfig;
  agentId: string;
  existingSnapshot?: SkillSnapshot;
  isFastTestEnv: boolean;
}): SkillSnapshot {
  if (params.isFastTestEnv) {
    // Fast unit-test mode skips filesystem scans and snapshot refresh writes.
    return params.existingSnapshot ?? { prompt: "", skills: [] };
  }

  const snapshotVersion = getSkillsSnapshotVersion(params.workspaceDir);
  const skillFilter = resolveAgentSkillsFilter(params.config, params.agentId);
  const existingSnapshot = params.existingSnapshot;
  const shouldRefresh = !canReuseSkillSnapshot({
    snapshot: existingSnapshot,
    snapshotVersion,
    config: params.config,
    skillFilter,
  });
  if (!shouldRefresh && existingSnapshot) {
    return existingSnapshot;
  }

  return buildWorkspaceSkillSnapshot(params.workspaceDir, {
    config: params.config,
    agentId: params.agentId,
    skillFilter,
    eligibility: { remote: getRemoteSkillEligibility() },
    snapshotVersion,
  });
}
