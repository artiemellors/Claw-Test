import { randomUUID } from "node:crypto";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";

const PLAMO_BEGIN_TOOL_REQUEST = "<|plamo:begin_tool_request:plamo|>";
const PLAMO_END_TOOL_REQUEST = "<|plamo:end_tool_request:plamo|>";
const PLAMO_BEGIN_TOOL_REQUESTS = "<|plamo:begin_tool_requests:plamo|>";
const PLAMO_END_TOOL_REQUESTS = "<|plamo:end_tool_requests:plamo|>";
const PLAMO_BEGIN_TOOL_NAME = "<|plamo:begin_tool_name:plamo|>";
const PLAMO_END_TOOL_NAME = "<|plamo:end_tool_name:plamo|>";
const PLAMO_BEGIN_TOOL_ARGUMENTS = "<|plamo:begin_tool_arguments:plamo|>";
const PLAMO_END_TOOL_ARGUMENTS = "<|plamo:end_tool_arguments:plamo|>";
const PLAMO_MSG = "<|plamo:msg|>";

const PLAMO_TOOL_REQUEST_BLOCK_RE = new RegExp(
  `${escapeRegExp(PLAMO_BEGIN_TOOL_REQUEST)}(.*?)${escapeRegExp(PLAMO_END_TOOL_REQUEST)}`,
  "gs",
);
const PLAMO_TOOL_REQUESTS_BLOCK_RE = new RegExp(
  `${escapeRegExp(PLAMO_BEGIN_TOOL_REQUESTS)}(.*?)${escapeRegExp(PLAMO_END_TOOL_REQUESTS)}`,
  "s",
);

type ParsedPlamoToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

type MessageContentBlock = {
  type?: unknown;
  text?: unknown;
};

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTaggedText(text: string, beginTag: string, endTag: string): string | null {
  const startIndex = text.indexOf(beginTag);
  if (startIndex === -1) {
    return null;
  }
  const contentStart = startIndex + beginTag.length;
  const endIndex = text.indexOf(endTag, contentStart);
  if (endIndex === -1) {
    return null;
  }
  return text.slice(contentStart, endIndex);
}

function extractToolArguments(block: string): string | null {
  const raw = extractTaggedText(block, PLAMO_BEGIN_TOOL_ARGUMENTS, PLAMO_END_TOOL_ARGUMENTS);
  if (raw === null) {
    return null;
  }
  const normalized = raw.includes(PLAMO_MSG) ? (raw.split(PLAMO_MSG, 2)[1] ?? "") : raw;
  return normalized.trim();
}

function parseToolArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTextBlock(
  block: unknown,
): block is MessageContentBlock & { type: "text"; text: string } {
  return (
    !!block &&
    typeof block === "object" &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

function hasToolCallBlock(content: unknown[]): boolean {
  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "toolCall" || type === "toolUse" || type === "functionCall";
  });
}

export function stripPlamoToolMarkup(text: string): string {
  return text
    .replace(PLAMO_TOOL_REQUESTS_BLOCK_RE, "")
    .replace(PLAMO_TOOL_REQUEST_BLOCK_RE, "")
    .trim();
}

export function parsePlamoToolCalls(text: string): ParsedPlamoToolCall[] {
  if (!text) {
    return [];
  }

  const toolRequestsMatch = PLAMO_TOOL_REQUESTS_BLOCK_RE.exec(text);
  const searchText = toolRequestsMatch?.[1] ?? text;
  const toolCalls: ParsedPlamoToolCall[] = [];

  for (const match of searchText.matchAll(PLAMO_TOOL_REQUEST_BLOCK_RE)) {
    const block = match[1] ?? "";
    const name = extractTaggedText(block, PLAMO_BEGIN_TOOL_NAME, PLAMO_END_TOOL_NAME)?.trim();
    const rawArguments = extractToolArguments(block);
    if (!name || rawArguments === null) {
      continue;
    }
    const argumentsObject = parseToolArguments(rawArguments);
    if (!argumentsObject) {
      continue;
    }
    toolCalls.push({
      name,
      arguments: argumentsObject,
    });
  }

  return toolCalls;
}

export function normalizePlamoToolMarkupInMessage(message: unknown): void {
  if (!message || typeof message !== "object") {
    return;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return;
  }

  const textBlocks = content.filter(isTextBlock);
  if (textBlocks.length === 0) {
    return;
  }

  const combinedText = textBlocks.map((block) => block.text).join("");
  if (
    !combinedText.includes(PLAMO_BEGIN_TOOL_REQUEST) &&
    !combinedText.includes(PLAMO_BEGIN_TOOL_REQUESTS)
  ) {
    return;
  }

  const cleanedText = stripPlamoToolMarkup(combinedText);
  const synthesizedToolCalls = hasToolCallBlock(content) ? [] : parsePlamoToolCalls(combinedText);

  const nextContent: unknown[] = [];
  let injectedText = false;
  for (const block of content) {
    if (!isTextBlock(block)) {
      nextContent.push(block);
      continue;
    }
    if (injectedText) {
      continue;
    }
    injectedText = true;
    if (cleanedText) {
      nextContent.push({ ...block, text: cleanedText });
    }
  }

  for (const toolCall of synthesizedToolCalls) {
    nextContent.push({
      type: "toolCall",
      id: `plamo_call_${randomUUID().replaceAll("-", "")}`,
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
  }

  (message as { content: unknown[] }).content = nextContent;
  if (synthesizedToolCalls.length > 0) {
    (message as { stopReason?: unknown }).stopReason = "toolUse";
  }
}

function wrapStreamNormalizePlamoToolMarkup(
  stream: ReturnType<typeof streamSimple>,
): ReturnType<typeof streamSimple> {
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const message = await originalResult();
    normalizePlamoToolMarkupInMessage(message);
    return message;
  };

  const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
  (stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[Symbol.asyncIterator] =
    function () {
      const iterator = originalAsyncIterator();
      return {
        async next() {
          const result = await iterator.next();
          if (!result.done && result.value && typeof result.value === "object") {
            const event = result.value as { partial?: unknown; message?: unknown };
            normalizePlamoToolMarkupInMessage(event.partial);
            normalizePlamoToolMarkupInMessage(event.message);
          }
          return result;
        },
        async return(value?: unknown) {
          return iterator.return?.(value) ?? { done: true as const, value: undefined };
        },
        async throw(error?: unknown) {
          return iterator.throw?.(error) ?? { done: true as const, value: undefined };
        },
      };
    };

  return stream;
}

export function createPlamoToolCallWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const maybeStream = underlying(model, context, options);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapStreamNormalizePlamoToolMarkup(stream),
      );
    }
    return wrapStreamNormalizePlamoToolMarkup(maybeStream);
  };
}
