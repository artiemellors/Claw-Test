export { normalizeCompatibilityConfig, legacyConfigRules } from "./src/doctor-contract.js";
export {
  collectRuntimeConfigAssignments,
  secretTargetRegistryEntries,
} from "./src/secret-contract.js";
export {
  TELEGRAM_COMMAND_NAME_PATTERN,
  normalizeTelegramCommandDescription,
  normalizeTelegramCommandName,
  resolveTelegramCustomCommands,
} from "./src/command-config.js";
export { singleAccountKeysToMove } from "./src/setup-contract.js";

export function hasConfiguredState(params: {
  cfg?: {
    channels?: {
      telegram?: { botToken?: string; tokenFile?: string; accounts?: Record<string, unknown> };
    };
  };
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (
    typeof params.env?.TELEGRAM_BOT_TOKEN === "string" &&
    params.env.TELEGRAM_BOT_TOKEN.trim().length > 0
  ) {
    return true;
  }
  const tg = params.cfg?.channels?.telegram;
  if (tg) {
    if (typeof tg.botToken === "string" && tg.botToken.trim().length > 0) {
      return true;
    }
    if (typeof tg.tokenFile === "string" && tg.tokenFile.trim().length > 0) {
      return true;
    }
    if (tg.accounts && Object.keys(tg.accounts).length > 0) {
      return true;
    }
  }
  return false;
}
