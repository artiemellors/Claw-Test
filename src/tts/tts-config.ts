import type { OpenClawConfig } from "../config/config.js";
import type { TtsMode } from "../config/types.tts.js";
import { resolveTtsConfig } from "./tts.js";
export { normalizeTtsAutoMode } from "./tts-auto-mode.js";

export function resolveConfiguredTtsMode(
  cfg: OpenClawConfig,
  context?: { agentId?: string; sessionKey?: string },
): TtsMode {
  return resolveTtsConfig({ cfg, ...context }).mode ?? "final";
}
