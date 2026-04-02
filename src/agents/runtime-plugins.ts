import type { OpenClawConfig } from "../config/config.js";
import { resolveRuntimePluginRegistry } from "../plugins/loader.js";
import { resolveUserPath } from "../utils.js";

export function ensureRuntimePluginsLoaded(params: {
  config?: OpenClawConfig;
  workspaceDir?: string | null;
  allowGatewaySubagentBinding?: boolean;
}): void {
  const workspaceDir =
    typeof params.workspaceDir === "string" && params.workspaceDir.trim()
      ? resolveUserPath(params.workspaceDir)
      : undefined;
  const loadOptions: Parameters<typeof resolveRuntimePluginRegistry>[0] = {
    config: params.config,
    workspaceDir,
  };
  if (params.allowGatewaySubagentBinding === true) {
    loadOptions.runtimeOptions = {
      allowGatewaySubagentBinding: true,
    };
  } else if (params.allowGatewaySubagentBinding === undefined) {
    loadOptions.inheritSharedRuntimeOptions = true;
  }
  resolveRuntimePluginRegistry(loadOptions);
}
