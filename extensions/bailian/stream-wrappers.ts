import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamWithPayloadPatch } from "openclaw/plugin-sdk/provider-stream";

type EphemeralCacheControl = { type: "ephemeral" };

const CACHE_CONTROL: EphemeralCacheControl = { type: "ephemeral" };

const CACHE_BOUNDARY = "\n<!-- OPENCLAW_CACHE_BOUNDARY -->\n";

type ContentBlock = Record<string, unknown>;
type Message = { role?: string; content?: unknown };

/**
 * Apply standard (non-aggressive) cache_control markers to an OpenAI-format
 * payload, matching the Anthropic direct-connect behavior:
 *
 * 1. System/developer messages: tag every text content block
 *    (with cache-boundary awareness — content after a boundary marker is left untagged).
 * 2. Last user message: tag its trailing content block.
 * 3. Assistant thinking/redacted_thinking blocks: strip any stale markers.
 */
export function applyBailianCacheControl(payloadObj: Record<string, unknown>): void {
  const messages = payloadObj.messages;
  if (!Array.isArray(messages)) {
    return;
  }

  for (const message of messages as Message[]) {
    if (message.role === "system" || message.role === "developer") {
      applySystemCacheControl(message);
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      cleanAssistantThinkingBlocks(message.content as ContentBlock[]);
    }
  }

  applyLastUserMessageCacheControl(messages as Message[]);
}

function applySystemCacheControl(message: Message): void {
  if (typeof message.content === "string") {
    const split = splitCacheBoundary(message.content);
    if (!split) {
      message.content = [{ type: "text", text: message.content, cache_control: CACHE_CONTROL }];
      return;
    }
    const blocks: ContentBlock[] = [];
    if (split.stablePrefix) {
      blocks.push({ type: "text", text: split.stablePrefix, cache_control: CACHE_CONTROL });
    }
    if (split.dynamicSuffix) {
      blocks.push({ type: "text", text: split.dynamicSuffix });
    }
    message.content = blocks;
    return;
  }

  if (!Array.isArray(message.content) || message.content.length === 0) {
    return;
  }

  const blocks = message.content as ContentBlock[];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (
      !block ||
      typeof block !== "object" ||
      block.type !== "text" ||
      typeof block.text !== "string"
    ) {
      continue;
    }

    const split = splitCacheBoundary(block.text as string);
    if (!split) {
      if (block.cache_control === undefined) {
        block.cache_control = CACHE_CONTROL;
      }
      continue;
    }

    // Replace this block with stable prefix (cached) + dynamic suffix (not cached).
    const replacement: ContentBlock[] = [];
    const { cache_control: _existing, ...rest } = block;
    if (split.stablePrefix) {
      replacement.push({ ...rest, text: split.stablePrefix, cache_control: CACHE_CONTROL });
    }
    if (split.dynamicSuffix) {
      replacement.push({ ...rest, text: split.dynamicSuffix });
    }
    blocks.splice(i, 1, ...replacement);
    i += replacement.length - 1;
  }
}

function applyLastUserMessageCacheControl(messages: Message[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      message.content = [{ type: "text", text: message.content, cache_control: CACHE_CONTROL }];
      return;
    }

    if (Array.isArray(message.content) && message.content.length > 0) {
      const lastBlock = message.content[message.content.length - 1] as ContentBlock | undefined;
      if (
        lastBlock &&
        typeof lastBlock === "object" &&
        (lastBlock.type === "text" ||
          lastBlock.type === "image" ||
          lastBlock.type === "tool_result")
      ) {
        lastBlock.cache_control = CACHE_CONTROL;
      }
    }
    return;
  }
}

function cleanAssistantThinkingBlocks(content: ContentBlock[]): void {
  for (const block of content) {
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      delete block.cache_control;
    }
  }
}

function splitCacheBoundary(
  text: string,
): { stablePrefix: string; dynamicSuffix: string } | undefined {
  const idx = text.indexOf(CACHE_BOUNDARY);
  if (idx === -1) {
    return undefined;
  }
  return {
    stablePrefix: text.slice(0, idx).trimEnd(),
    dynamicSuffix: text.slice(idx + CACHE_BOUNDARY.length).trimStart(),
  };
}

export function createBailianCacheControlWrapper(
  baseStreamFn: StreamFn | undefined,
): StreamFn | undefined {
  if (!baseStreamFn) {
    return undefined;
  }
  return (model, context, options) =>
    streamWithPayloadPatch(baseStreamFn, model, context, options, applyBailianCacheControl);
}
