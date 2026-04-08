export const CHAT_AUTOSTART_BOOTSTRAP_PROMPT = "Please introduce yourself to the user.";

const CHAT_AUTOSTART_BOOTSTRAP_VALUES = new Set(["1", "true", "yes", "on", "bootstrap"]);

export function resolveChatAutostartPrompt(raw: string | null): string | null {
  if (raw == null) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return CHAT_AUTOSTART_BOOTSTRAP_VALUES.has(normalized) ? CHAT_AUTOSTART_BOOTSTRAP_PROMPT : null;
}
