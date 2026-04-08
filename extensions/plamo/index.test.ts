import { streamSimple } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompletionsTransportStreamFn } from "../../src/agents/openai-transport-stream.js";
import { resolveEmbeddedAgentStreamFn } from "../../src/agents/pi-embedded-runner/stream-resolution.js";
import {
  installPinnedHostnameTestHooks,
  resolveRequestUrl,
} from "../../src/media-understanding/audio.test-helpers.ts";
import { resolveProviderPluginChoice } from "../../src/plugins/provider-wizard.js";
import { withFetchPreconnect } from "../../src/test-utils/fetch-mock.js";
import { registerSingleProviderPlugin } from "../../test/helpers/plugins/plugin-registration.js";
import plamoPlugin from "./index.js";
import { normalizePlamoToolMarkupInMessage } from "./stream.js";

type FakeWrappedStream = {
  result: () => Promise<unknown>;
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
};

function createFakeStream(params: {
  events: unknown[];
  resultMessage: unknown;
}): FakeWrappedStream {
  return {
    async result() {
      return params.resultMessage;
    },
    [Symbol.asyncIterator]() {
      return (async function* () {
        for (const event of params.events) {
          yield event;
        }
      })();
    },
  };
}

installPinnedHostnameTestHooks();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PLAMO_TEST_BASE_URL = "https://api.platform.preferredai.example/v1";

function createTextStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function createSseResponse(chunks: string[]): Response {
  return new Response(createTextStream(chunks), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function stubPlamoSseFetch(chunks: string[]) {
  let seenUrl: string | null = null;
  let seenInit: RequestInit | undefined;
  const fetchMock = withFetchPreconnect(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = resolveRequestUrl(input);
      seenInit = init;
      return createSseResponse(chunks);
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    getRequest: () => ({ url: seenUrl, init: seenInit }),
  };
}

function toRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
}

function formatSseEvent(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function splitEvery(text: string, size: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    out.push(text.slice(index, index + size));
  }
  return out;
}

async function loadPlamoCatalog() {
  const provider = await registerSingleProviderPlugin(plamoPlugin);
  const catalog = await provider.catalog!.run({
    config: {},
    env: {},
    resolveProviderApiKey: () => ({ apiKey: "test-key" }),
    resolveProviderAuth: () => ({
      apiKey: "test-key",
      mode: "api_key",
      source: "env",
    }),
  } as never);

  if (!catalog || !("provider" in catalog)) {
    throw new Error("expected single-provider catalog");
  }

  return { provider, catalog };
}

function createWrappedPlamoStream(
  provider: Awaited<ReturnType<typeof registerSingleProviderPlugin>>,
  options?: {
    extraParams?: Record<string, unknown>;
    modelId?: string;
    streamFn?: unknown;
  },
) {
  const wrapped = provider.wrapStreamFn?.({
    provider: "plamo",
    modelId: options?.modelId ?? "plamo-3.0-prime-beta",
    streamFn: (options?.streamFn ?? streamSimple) as never,
    extraParams: options?.extraParams ?? {},
  } as never);
  if (!wrapped) {
    throw new Error("expected wrapped stream function");
  }
  return wrapped;
}

describe("plamo provider plugin", () => {
  it("registers PLaMo with api-key auth wizard metadata", async () => {
    const provider = await registerSingleProviderPlugin(plamoPlugin);
    const resolved = resolveProviderPluginChoice({
      providers: [provider],
      choice: "plamo-api-key",
    });

    expect(provider.id).toBe("plamo");
    expect(provider.label).toBe("PLaMo");
    expect(provider.envVars).toEqual(["PLAMO_API_KEY"]);
    expect(provider.auth).toHaveLength(1);
    expect(provider.capabilities).toMatchObject({
      dropThinkingBlockModelHints: ["plamo"],
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.provider.id).toBe("plamo");
    expect(resolved?.method.id).toBe("api-key");
  });

  it("builds the static PLaMo model catalog", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    expect(provider.catalog).toBeDefined();

    expect(catalog.provider.api).toBe("openai-completions");
    expect(catalog.provider.baseUrl).toBe("https://api.platform.preferredai.jp/v1");
    expect(catalog.provider.models).toEqual([
      {
        id: "plamo-3.0-prime-beta",
        name: "PLaMo 3.0 Prime Beta",
        reasoning: false,
        input: ["text"],
        cost: { input: 0.375, output: 1.5625, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 65_536,
        maxTokens: 20_000,
        compat: {
          maxTokensField: "max_tokens",
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStore: false,
          supportsStrictMode: false,
        },
      },
    ]);
  });

  it("drops replayed assistant thinking blocks before sending follow-up turns", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    const { getRequest } = stubPlamoSseFetch([
      formatSseEvent({
        id: "chatcmpl-stream-test",
        choices: [{ index: 0, delta: { content: "ok" } }],
      }),
      formatSseEvent({
        id: "chatcmpl-stream-test",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      "data: [DONE]\n\n",
    ]);

    const [model] = catalog.provider.models;
    const wrapped = createWrappedPlamoStream(provider);

    const stream = await wrapped(
      {
        ...model,
        provider: "plamo",
        api: "openai-completions",
        baseUrl: PLAMO_TEST_BASE_URL,
      } as never,
      {
        systemPrompt: "system prompt",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "internal reasoning that must not be replayed",
                thinkingSignature: "reasoning_content",
              },
              { type: "text", text: "前回の回答です。" },
            ],
          },
          { role: "user", content: "続けて" },
        ],
      } as never,
      {
        apiKey: "test-key",
        reasoningEffort: "low",
      } as never,
    );

    for await (const _event of stream) {
      // Drain the stream so the request completes.
    }
    await stream.result();

    const request = getRequest();
    const body = toRequestBody(request.init);
    expect(body.max_tokens).toBe(20_000);
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "assistant", content: "前回の回答です。" },
      { role: "user", content: "続けて" },
    ]);
    expect((body.messages as Array<Record<string, unknown>>)[1]).not.toHaveProperty(
      "reasoning_content",
    );
  });

  it("sends the documented streaming payload and auth headers on the wire", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    const { getRequest } = stubPlamoSseFetch([
      formatSseEvent({
        id: "chatcmpl-stream-test",
        choices: [{ index: 0, delta: { content: "ok" } }],
      }),
      formatSseEvent({
        id: "chatcmpl-stream-test",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      "data: [DONE]\n\n",
    ]);

    const [model] = catalog.provider.models;
    const wrapped = createWrappedPlamoStream(provider);
    const stream = await wrapped(
      {
        ...model,
        provider: "plamo",
        api: "openai-completions",
        baseUrl: PLAMO_TEST_BASE_URL,
      } as never,
      {
        systemPrompt: "system prompt",
        messages: [{ role: "user", content: "こんにちは" }],
        tools: [
          {
            name: "read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        ],
      } as never,
      {
        apiKey: "test-key",
        maxTokens: 512,
        reasoningEffort: "low",
        onPayload: async (payload: unknown) => ({
          ...(payload as Record<string, unknown>),
          stream_options: { include_usage: true },
          store: false,
          reasoning_effort: "low",
        }),
      } as never,
    );

    let result: Awaited<ReturnType<typeof stream.result>> | undefined;
    for await (const _event of stream) {
      // Drain the stream so the request completes.
    }
    result = await stream.result();

    expect(result).toMatchObject({
      stopReason: "stop",
      content: [{ type: "text", text: "ok" }],
    });

    const request = getRequest();
    const headers = new Headers(request.init?.headers);
    const body = toRequestBody(request.init);
    expect(request.url).toBe(`${PLAMO_TEST_BASE_URL}/chat/completions`);
    expect(request.init?.method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("content-type")).toContain("application/json");
    expect(body).toMatchObject({
      model: "plamo-3.0-prime-beta",
      max_tokens: 512,
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "こんにちは" },
      ],
      stream: true,
      tools: [
        {
          type: "function",
          function: {
            name: "read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      ],
    });
    expect(body).not.toHaveProperty("stream_options");
    expect(body).not.toHaveProperty("store");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(
      (body.tools as Array<{ function?: { strict?: unknown } }> | undefined)?.[0]?.function,
    ).not.toHaveProperty("strict");
  });

  it("blocks private-network native baseUrl overrides before issuing fetch", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    const fetchMock = withFetchPreconnect(
      vi.fn(async () =>
        createSseResponse([
          formatSseEvent({
            id: "chatcmpl-unreachable",
            choices: [{ index: 0, delta: { content: "unexpected" } }],
          }),
          "data: [DONE]\n\n",
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [model] = catalog.provider.models;
    const wrapped = createWrappedPlamoStream(provider);
    const stream = await wrapped(
      {
        ...model,
        provider: "plamo",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:11434/v1",
      } as never,
      {
        systemPrompt: "system prompt",
        messages: [{ role: "user", content: "こんにちは" }],
      } as never,
      {
        apiKey: "test-key",
      } as never,
    );

    await expect(stream.result()).resolves.toMatchObject({
      stopReason: "error",
      errorMessage: "Blocked hostname or private/internal/special-use IP address",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reassembles fragmented native SSE chunks without truncating the final text", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    const chunks = [
      formatSseEvent({
        id: "chatcmpl-stream-fragmented",
        choices: [{ index: 0, delta: { reasoning_content: "thinking " } }],
      }),
      formatSseEvent({
        id: "chatcmpl-stream-fragmented",
        choices: [{ index: 0, delta: { content: "明日" } }],
      }),
      formatSseEvent({
        id: "chatcmpl-stream-fragmented",
        choices: [{ index: 0, delta: { content: "は晴れ" } }],
      }),
      formatSseEvent({
        id: "chatcmpl-stream-fragmented",
        choices: [{ index: 0, delta: { content: "です。" }, finish_reason: "stop" }],
      }),
      formatSseEvent({
        id: "chatcmpl-stream-fragmented",
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
        choices: [],
      }),
      "data: [DONE]\n\n",
    ].flatMap((chunk) => splitEvery(chunk, 7));
    stubPlamoSseFetch(chunks);

    const [model] = catalog.provider.models;
    const wrapped = createWrappedPlamoStream(provider);
    const stream = await wrapped(
      {
        ...model,
        provider: "plamo",
        api: "openai-completions",
        baseUrl: PLAMO_TEST_BASE_URL,
      } as never,
      {
        systemPrompt: "system prompt",
        messages: [{ role: "user", content: "こんにちは" }],
      } as never,
      {
        apiKey: "test-key",
      } as never,
    );

    const deltas: string[] = [];
    let result: Awaited<ReturnType<typeof stream.result>> | undefined;
    for await (const event of stream) {
      if (event.type === "text_delta") {
        deltas.push(event.delta);
      }
    }
    result = await stream.result();

    expect(deltas.join("")).toBe("明日は晴れです。");
    expect(result).toMatchObject({
      stopReason: "stop",
      usage: { input: 11, output: 5, totalTokens: 16 },
      content: [
        { type: "thinking", thinking: "thinking " },
        { type: "text", text: "明日は晴れです。" },
      ],
    });
  });

  it("clamps cached prompt reuse and does not double-count reasoning tokens in usage", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    stubPlamoSseFetch([
      formatSseEvent({
        id: "chatcmpl-usage-clamp",
        choices: [{ index: 0, delta: { content: "ok" } }],
      }),
      formatSseEvent({
        id: "chatcmpl-usage-clamp",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 7,
          prompt_tokens_details: { cached_tokens: 10 },
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      }),
      "data: [DONE]\n\n",
    ]);

    const [model] = catalog.provider.models;
    const wrapped = createWrappedPlamoStream(provider);
    const stream = await wrapped(
      {
        ...model,
        provider: "plamo",
        api: "openai-completions",
        baseUrl: PLAMO_TEST_BASE_URL,
      } as never,
      {
        systemPrompt: "system prompt",
        messages: [{ role: "user", content: "こんにちは" }],
      } as never,
      {
        apiKey: "test-key",
      } as never,
    );

    let result: Awaited<ReturnType<typeof stream.result>> | undefined;
    for await (const _event of stream) {
      // Drain the stream so the request completes.
    }
    result = await stream.result();

    expect(result).toMatchObject({
      stopReason: "stop",
      usage: {
        input: 0,
        output: 7,
        cacheRead: 10,
        totalTokens: 17,
      },
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("tracks interleaved native tool-call deltas by index when follow-up chunks omit ids", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    stubPlamoSseFetch([
      formatSseEvent({
        id: "chatcmpl-tool-index",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_read",
                  type: "function",
                  function: { name: "read", arguments: '{"path":"' },
                },
                {
                  index: 1,
                  id: "call_write",
                  type: "function",
                  function: { name: "write", arguments: '{"path":"' },
                },
              ],
            },
          },
        ],
      }),
      formatSseEvent({
        id: "chatcmpl-tool-index",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  type: "function",
                  function: { arguments: 'out.txt",' },
                },
                {
                  index: 0,
                  type: "function",
                  function: { arguments: 'README.md",' },
                },
              ],
            },
          },
        ],
      }),
      formatSseEvent({
        id: "chatcmpl-tool-index",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  type: "function",
                  function: { arguments: '"content":"hi"}' },
                },
                {
                  index: 0,
                  type: "function",
                  function: { arguments: '"mode":"r"}' },
                },
              ],
              finish_reason: "tool_calls",
            },
          },
        ],
      }),
      "data: [DONE]\n\n",
    ]);

    const [model] = catalog.provider.models;
    const wrapped = createWrappedPlamoStream(provider);
    const stream = await wrapped(
      {
        ...model,
        provider: "plamo",
        api: "openai-completions",
        baseUrl: PLAMO_TEST_BASE_URL,
      } as never,
      {
        systemPrompt: "system prompt",
        messages: [{ role: "user", content: "tool test" }],
      } as never,
      {
        apiKey: "test-key",
      } as never,
    );

    const deltas: Array<{ contentIndex: number; delta: string }> = [];
    let result: Awaited<ReturnType<typeof stream.result>> | undefined;
    for await (const event of stream) {
      if (event.type === "toolcall_delta") {
        deltas.push({ contentIndex: event.contentIndex, delta: event.delta });
      }
    }
    result = await stream.result();

    expect(deltas).toEqual([
      { contentIndex: 0, delta: '{"path":"' },
      { contentIndex: 1, delta: '{"path":"' },
      { contentIndex: 1, delta: 'out.txt",' },
      { contentIndex: 0, delta: 'README.md",' },
      { contentIndex: 1, delta: '"content":"hi"}' },
      { contentIndex: 0, delta: '"mode":"r"}' },
    ]);
    expect(result).toMatchObject({
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "call_read",
          name: "read",
          arguments: { path: "README.md", mode: "r" },
        },
        {
          type: "toolCall",
          id: "call_write",
          name: "write",
          arguments: { path: "out.txt", content: "hi" },
        },
      ],
    });
  });

  it("keeps using the native parser when the base stream fn is an auth-wrapped OpenAI completions transport", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    stubPlamoSseFetch([
      formatSseEvent({
        id: "chatcmpl-tool-index-transport",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_read",
                  type: "function",
                  function: { name: "read", arguments: '{"path":"' },
                },
                {
                  index: 1,
                  id: "call_write",
                  type: "function",
                  function: { name: "write", arguments: '{"path":"' },
                },
              ],
            },
          },
        ],
      }),
      formatSseEvent({
        id: "chatcmpl-tool-index-transport",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  type: "function",
                  function: { arguments: 'out.txt",' },
                },
                {
                  index: 0,
                  type: "function",
                  function: { arguments: 'README.md",' },
                },
              ],
            },
          },
        ],
      }),
      formatSseEvent({
        id: "chatcmpl-tool-index-transport",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  type: "function",
                  function: { arguments: '"content":"hi"}' },
                },
                {
                  index: 0,
                  type: "function",
                  function: { arguments: '"mode":"r"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
      "data: [DONE]\n\n",
    ]);

    const [model] = catalog.provider.models;
    const transportStreamFn = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn: createOpenAICompletionsTransportStreamFn(),
      shouldUseWebSocketTransport: false,
      sessionId: "session-1",
      model: {
        ...model,
        provider: "plamo",
        api: "openai-completions",
      } as never,
      resolvedApiKey: "resolved-key",
    });
    const wrapped = createWrappedPlamoStream(provider, {
      streamFn: transportStreamFn,
    });
    const stream = await wrapped(
      {
        ...model,
        provider: "plamo",
        api: "openai-completions",
        baseUrl: PLAMO_TEST_BASE_URL,
      } as never,
      {
        systemPrompt: "system prompt",
        messages: [{ role: "user", content: "tool test" }],
      } as never,
      {
        apiKey: "test-key",
      } as never,
    );

    const deltas: Array<{ contentIndex: number; delta: string }> = [];
    let result: Awaited<ReturnType<typeof stream.result>> | undefined;
    for await (const event of stream) {
      if (event.type === "toolcall_delta") {
        deltas.push({ contentIndex: event.contentIndex, delta: event.delta });
      }
    }
    result = await stream.result();

    expect(deltas).toEqual([
      { contentIndex: 0, delta: '{"path":"' },
      { contentIndex: 1, delta: '{"path":"' },
      { contentIndex: 1, delta: 'out.txt",' },
      { contentIndex: 0, delta: 'README.md",' },
      { contentIndex: 1, delta: '"content":"hi"}' },
      { contentIndex: 0, delta: '"mode":"r"}' },
    ]);
    expect(result).toMatchObject({
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "call_read",
          name: "read",
          arguments: { path: "README.md", mode: "r" },
        },
        {
          type: "toolCall",
          id: "call_write",
          name: "write",
          arguments: { path: "out.txt", content: "hi" },
        },
      ],
    });
  });

  it("preserves text-block ordering when normalizing inline PLaMo tool markup", () => {
    const toolMarkup =
      "<|plamo:begin_tool_requests:plamo|>" +
      "<|plamo:begin_tool_request:plamo|>" +
      "<|plamo:begin_tool_name:plamo|>read<|plamo:end_tool_name:plamo|>" +
      '<|plamo:begin_tool_arguments:plamo|><|plamo:msg|>{"path":"README.md"}' +
      "<|plamo:end_tool_arguments:plamo|>" +
      "<|plamo:end_tool_request:plamo|>" +
      "<|plamo:end_tool_requests:plamo|>";
    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "First segment." },
        { type: "thinking", thinking: "internal", thinkingSignature: "reasoning_content" },
        { type: "text", text: `Second segment before tool.\n${toolMarkup}` },
        { type: "text", text: "\nThird segment after tool." },
      ],
    };

    normalizePlamoToolMarkupInMessage(message);

    expect(message).toMatchObject({
      stopReason: "toolUse",
      content: [
        { type: "text", text: "First segment." },
        { type: "thinking", thinking: "internal", thinkingSignature: "reasoning_content" },
        { type: "text", text: "Second segment before tool.\n" },
        { type: "toolCall", name: "read", arguments: { path: "README.md" } },
        { type: "text", text: "\nThird segment after tool." },
      ],
    });
  });

  it("normalizes inline PLaMo tool markup in native stream results without synthetic toolcall events", async () => {
    const { provider, catalog } = await loadPlamoCatalog();
    const toolMarkup =
      "<|plamo:begin_tool_requests:plamo|>" +
      "<|plamo:begin_tool_request:plamo|>" +
      "<|plamo:begin_tool_name:plamo|>read<|plamo:end_tool_name:plamo|>" +
      '<|plamo:begin_tool_arguments:plamo|><|plamo:msg|>{"path":"README.md"}' +
      "<|plamo:end_tool_arguments:plamo|>" +
      "<|plamo:end_tool_request:plamo|>" +
      "<|plamo:end_tool_requests:plamo|>";
    stubPlamoSseFetch([
      formatSseEvent({
        id: "chatcmpl-tool",
        choices: [{ index: 0, delta: { content: `I will inspect the file.\n${toolMarkup}` } }],
      }),
      formatSseEvent({
        id: "chatcmpl-tool",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
      "data: [DONE]\n\n",
    ]);

    const [model] = catalog.provider.models;
    const wrapped = createWrappedPlamoStream(provider);
    const stream = await wrapped(
      {
        ...model,
        provider: "plamo",
        api: "openai-completions",
        baseUrl: PLAMO_TEST_BASE_URL,
      } as never,
      {
        systemPrompt: "system prompt",
        messages: [{ role: "user", content: "こんにちは" }],
      } as never,
      {
        apiKey: "test-key",
      } as never,
    );

    const eventTypes: string[] = [];
    let result: Awaited<ReturnType<typeof stream.result>> | undefined;
    for await (const event of stream) {
      eventTypes.push(event.type);
    }
    result = await stream.result();

    expect(eventTypes).not.toContain("toolcall_start");
    expect(eventTypes).not.toContain("toolcall_delta");
    expect(eventTypes).not.toContain("toolcall_end");
    expect(result).toMatchObject({
      stopReason: "toolUse",
      content: [
        {
          type: "text",
          text: "I will inspect the file.",
        },
        {
          type: "toolCall",
          name: "read",
          arguments: { path: "README.md" },
        },
      ],
    });
  });

  it("defaults to native streaming and only normalizes finalized PLaMo tool markup", async () => {
    const provider = await registerSingleProviderPlugin(plamoPlugin);
    const toolMarkup =
      "<|plamo:begin_tool_requests:plamo|>" +
      "<|plamo:begin_tool_request:plamo|>" +
      "<|plamo:begin_tool_name:plamo|>read<|plamo:end_tool_name:plamo|>" +
      '<|plamo:begin_tool_arguments:plamo|><|plamo:msg|>{"path":"README.md"}' +
      "<|plamo:end_tool_arguments:plamo|>" +
      "<|plamo:end_tool_request:plamo|>" +
      "<|plamo:end_tool_requests:plamo|>";
    const partialMessage = {
      role: "assistant",
      content: [{ type: "text", text: `Checking...${toolMarkup}` }],
    };
    const streamedMessage = {
      role: "assistant",
      content: [{ type: "text", text: `Reading now.${toolMarkup}` }],
    };
    const finalMessage = {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: `I will inspect the file.\n${toolMarkup}` }],
    };

    const baseFn = vi.fn(() =>
      createFakeStream({
        events: [{ partial: partialMessage, message: streamedMessage }],
        resultMessage: finalMessage,
      }),
    );

    const wrapped = provider.wrapStreamFn?.({
      provider: "plamo",
      modelId: "plamo-3.0-prime-beta",
      streamFn: baseFn as never,
      extraParams: {},
    } as never);
    if (!wrapped) {
      throw new Error("expected wrapped stream function");
    }

    const stream = await wrapped(
      {
        api: "openai-completions",
        provider: "plamo",
        id: "plamo-3.0-prime-beta",
      } as never,
      { messages: [] } as never,
      {} as never,
    );

    for await (const _event of stream) {
      // Drain the wrapped stream so live partial mutations run.
    }
    const result = await stream.result();

    expect(baseFn).toHaveBeenCalledTimes(1);
    expect(partialMessage.content).toMatchObject([
      { type: "text", text: `Checking...${toolMarkup}` },
    ]);
    expect(streamedMessage.content).toMatchObject([
      { type: "text", text: "Reading now." },
      { type: "toolCall", name: "read", arguments: { path: "README.md" } },
    ]);
    expect(finalMessage.content).toMatchObject([
      { type: "text", text: "I will inspect the file." },
      { type: "toolCall", name: "read", arguments: { path: "README.md" } },
    ]);
    expect(finalMessage).toMatchObject({ stopReason: "toolUse" });
    expect(result).toBe(finalMessage);
  });

  it("preserves non-stop finish reasons when normalizing finalized PLaMo tool markup", async () => {
    const provider = await registerSingleProviderPlugin(plamoPlugin);
    const toolMarkup =
      "<|plamo:begin_tool_requests:plamo|>" +
      "<|plamo:begin_tool_request:plamo|>" +
      "<|plamo:begin_tool_name:plamo|>read<|plamo:end_tool_name:plamo|>" +
      '<|plamo:begin_tool_arguments:plamo|><|plamo:msg|>{"path":"README.md"}' +
      "<|plamo:end_tool_arguments:plamo|>" +
      "<|plamo:end_tool_request:plamo|>" +
      "<|plamo:end_tool_requests:plamo|>";
    const finalMessage = {
      role: "assistant",
      stopReason: "length",
      content: [{ type: "text", text: `I will inspect the file.\n${toolMarkup}` }],
    };

    const baseFn = vi.fn(() =>
      createFakeStream({
        events: [],
        resultMessage: finalMessage,
      }),
    );

    const wrapped = provider.wrapStreamFn?.({
      provider: "plamo",
      modelId: "plamo-3.0-prime-beta",
      streamFn: baseFn as never,
      extraParams: {},
    } as never);
    if (!wrapped) {
      throw new Error("expected wrapped stream function");
    }

    const stream = await wrapped(
      {
        api: "openai-completions",
        provider: "plamo",
        id: "plamo-3.0-prime-beta",
      } as never,
      { messages: [] } as never,
      {} as never,
    );

    const result = await stream.result();

    expect(baseFn).toHaveBeenCalledTimes(1);
    expect(finalMessage).toMatchObject({
      stopReason: "length",
      content: [
        { type: "text", text: "I will inspect the file." },
        { type: "toolCall", name: "read", arguments: { path: "README.md" } },
      ],
    });
    expect(result).toBe(finalMessage);
  });
});
