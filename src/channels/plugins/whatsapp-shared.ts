import type { OpenClawConfig } from "../../config/config.js";
import { resolveOutboundSendDep } from "../../infra/outbound/send-deps.js";
import { createAttachedChannelResultAdapter } from "../../plugin-sdk/channel-send-result.js";
import type { PollInput } from "../../polls.js";
import { escapeRegExp } from "../../utils.js";
import type { ChannelOutboundAdapter } from "./types.js";

export const WHATSAPP_GROUP_INTRO_HINT =
  "WhatsApp IDs: SenderId is the participant JID (group participant id).";

/**
 * Returns the resolved system prompt for a WhatsApp group chat given a pre-resolved
 * account config slice.
 *
 * Resolution order:
 *   1. groups["<groupId>"].systemPrompt — specific group entry, if it defines a prompt.
 *   2. groups["*"].systemPrompt         — wildcard entry, used when the specific group
 *      entry is absent or defines no prompt.
 *
 * The caller is responsible for resolving the account config before calling this
 * function. Account groups fully replace root groups (no deep merge), so the slice
 * passed in already reflects the correct precedence.
 *
 * Returns undefined when no matching prompt is found.
 */
export function resolveWhatsAppGroupSystemPrompt(params: {
  accountConfig?: { groups?: Record<string, { systemPrompt?: string }> } | null;
  groupId?: string | null;
}): string | undefined {
  // Get group-level systemPrompt if groupId is provided.
  // Resolve per-field: use the specific group's systemPrompt if set, otherwise
  // fall back to the wildcard "*" entry so default prompts still apply even when
  // the specific group entry only defines non-prompt settings (e.g. requireMention).
  let groupSystemPrompt: string | undefined;
  if (params.groupId) {
    const groups = params.accountConfig?.groups;
    // Resolution order: specific group entry → wildcard "*" entry.
    // Root groups naturally reach here when the account defines no groups of its
    // own (resolveWhatsAppAccount uses override-not-merge semantics, same as
    // resolveChannelGroups: accountGroups ?? rootGroups).
    groupSystemPrompt =
      groups?.[params.groupId]?.systemPrompt?.trim() ||
      groups?.["*"]?.systemPrompt?.trim() ||
      undefined;
  }
  return groupSystemPrompt;
}

/**
 * Returns the resolved system prompt for a WhatsApp direct (1:1) chat given a
 * pre-resolved account config slice.
 *
 * Resolution order:
 *   1. direct["<peerId>"].systemPrompt — specific peer entry, if it defines a prompt.
 *   2. direct["*"].systemPrompt        — wildcard entry, used when the specific peer
 *      entry is absent or defines no prompt.
 *
 * The caller is responsible for resolving the account config before calling this
 * function. Account direct maps fully replace root direct maps (no deep merge), so
 * the slice passed in already reflects the correct precedence.
 *
 * Returns undefined when no matching prompt is found or peerId is not provided.
 */
export function resolveWhatsAppDirectSystemPrompt(params: {
  accountConfig?: { direct?: Record<string, { systemPrompt?: string }> } | null;
  peerId?: string | null;
}): string | undefined {
  let directSystemPrompt: string | undefined;
  if (params.peerId) {
    const direct = params.accountConfig?.direct;
    directSystemPrompt =
      direct?.[params.peerId]?.systemPrompt?.trim() ||
      direct?.["*"]?.systemPrompt?.trim() ||
      undefined;
  }
  return directSystemPrompt;
}

export function resolveWhatsAppGroupIntroHint(): string {
  return WHATSAPP_GROUP_INTRO_HINT;
}

export function resolveWhatsAppMentionStripRegexes(ctx: { To?: string | null }): RegExp[] {
  const selfE164 = (ctx.To ?? "").replace(/^whatsapp:/, "");
  if (!selfE164) {
    return [];
  }
  const escaped = escapeRegExp(selfE164);
  return [new RegExp(escaped, "g"), new RegExp(`@${escaped}`, "g")];
}

type WhatsAppChunker = NonNullable<ChannelOutboundAdapter["chunker"]>;
type WhatsAppSendMessage = (
  to: string,
  body: string,
  options: {
    verbose: boolean;
    cfg?: OpenClawConfig;
    mediaUrl?: string;
    mediaAccess?: {
      localRoots?: readonly string[];
      readFile?: (filePath: string) => Promise<Buffer>;
    };
    mediaLocalRoots?: readonly string[];
    mediaReadFile?: (filePath: string) => Promise<Buffer>;
    gifPlayback?: boolean;
    accountId?: string;
  },
) => Promise<{ messageId: string; toJid: string }>;
type WhatsAppSendPoll = (
  to: string,
  poll: PollInput,
  options: { verbose: boolean; accountId?: string; cfg?: OpenClawConfig },
) => Promise<{ messageId: string; toJid: string }>;

type CreateWhatsAppOutboundBaseParams = {
  chunker: WhatsAppChunker;
  sendMessageWhatsApp: WhatsAppSendMessage;
  sendPollWhatsApp: WhatsAppSendPoll;
  shouldLogVerbose: () => boolean;
  resolveTarget: ChannelOutboundAdapter["resolveTarget"];
  normalizeText?: (text: string | undefined) => string;
  skipEmptyText?: boolean;
};

export function createWhatsAppOutboundBase({
  chunker,
  sendMessageWhatsApp,
  sendPollWhatsApp,
  shouldLogVerbose,
  resolveTarget,
  normalizeText = (text) => text ?? "",
  skipEmptyText = false,
}: CreateWhatsAppOutboundBaseParams): Pick<
  ChannelOutboundAdapter,
  | "deliveryMode"
  | "chunker"
  | "chunkerMode"
  | "textChunkLimit"
  | "pollMaxOptions"
  | "resolveTarget"
  | "sendText"
  | "sendMedia"
  | "sendPoll"
> {
  return {
    deliveryMode: "gateway",
    chunker,
    chunkerMode: "text",
    textChunkLimit: 4000,
    pollMaxOptions: 12,
    resolveTarget,
    ...createAttachedChannelResultAdapter({
      channel: "whatsapp",
      sendText: async ({ cfg, to, text, accountId, deps, gifPlayback }) => {
        const normalizedText = normalizeText(text);
        if (skipEmptyText && !normalizedText) {
          return { messageId: "" };
        }
        const send =
          resolveOutboundSendDep<WhatsAppSendMessage>(deps, "whatsapp") ?? sendMessageWhatsApp;
        return await send(to, normalizedText, {
          verbose: false,
          cfg,
          accountId: accountId ?? undefined,
          gifPlayback,
        });
      },
      sendMedia: async ({
        cfg,
        to,
        text,
        mediaUrl,
        mediaAccess,
        mediaLocalRoots,
        mediaReadFile,
        accountId,
        deps,
        gifPlayback,
      }) => {
        const send =
          resolveOutboundSendDep<WhatsAppSendMessage>(deps, "whatsapp") ?? sendMessageWhatsApp;
        return await send(to, normalizeText(text), {
          verbose: false,
          cfg,
          mediaUrl,
          mediaAccess,
          mediaLocalRoots,
          mediaReadFile,
          accountId: accountId ?? undefined,
          gifPlayback,
        });
      },
      sendPoll: async ({ cfg, to, poll, accountId }) =>
        await sendPollWhatsApp(to, poll, {
          verbose: shouldLogVerbose(),
          accountId: accountId ?? undefined,
          cfg,
        }),
    }),
  };
}
