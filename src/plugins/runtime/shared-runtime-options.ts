import type { CreatePluginRuntimeOptions } from "./index.js";

const SHARED_PLUGIN_RUNTIME_OPTIONS_KEY: unique symbol = Symbol.for(
  "openclaw.sharedPluginRuntimeOptions",
);

type SharedPluginRuntimeOptionsState = {
  options?: CreatePluginRuntimeOptions;
};

function getSharedPluginRuntimeOptionsState(): SharedPluginRuntimeOptionsState {
  const globalState = globalThis as typeof globalThis & {
    [SHARED_PLUGIN_RUNTIME_OPTIONS_KEY]?: SharedPluginRuntimeOptionsState;
  };
  const existing = globalState[SHARED_PLUGIN_RUNTIME_OPTIONS_KEY];
  if (existing) {
    return existing;
  }
  const created: SharedPluginRuntimeOptionsState = {};
  globalState[SHARED_PLUGIN_RUNTIME_OPTIONS_KEY] = created;
  return created;
}

export function setSharedPluginRuntimeOptions(options: CreatePluginRuntimeOptions): void {
  getSharedPluginRuntimeOptionsState().options = options;
}

export function getSharedPluginRuntimeOptions(): CreatePluginRuntimeOptions | undefined {
  return getSharedPluginRuntimeOptionsState().options;
}

export function clearSharedPluginRuntimeOptions(): void {
  getSharedPluginRuntimeOptionsState().options = undefined;
}

export function getPluginRuntimeCapabilityKey(
  options?: CreatePluginRuntimeOptions,
): Record<string, boolean> {
  // Current callers resolve either an explicit `subagent` runtime or
  // `allowGatewaySubagentBinding`, not both at once. Keep both booleans in the
  // cache key so a future mixed state cannot collide silently with either mode.
  return {
    subagent: Boolean(options?.subagent),
    gatewaySubagentBinding: options?.allowGatewaySubagentBinding === true,
  };
}
