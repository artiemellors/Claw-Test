import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Context, Model } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  createDeepInfraSystemCacheWrapper,
  createDeepInfraWrapper,
  createOpenRouterSystemCacheWrapper,
  createOpenRouterWrapper,
} from "./proxy-stream-wrappers.js";

describe("proxy stream wrappers", () => {
  it("adds OpenRouter attribution headers to stream options", () => {
    const calls: Array<{ headers?: Record<string, string> }> = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      calls.push({
        headers: options?.headers,
      });
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterWrapper(baseStreamFn);
    const model = {
      api: "openai-completions",
      provider: "openrouter",
      id: "openrouter/auto",
    } as Model<"openai-completions">;
    const context: Context = { messages: [] };

    void wrapped(model, context, { headers: { "X-Custom": "1" } });

    expect(calls).toEqual([
      {
        headers: {
          "HTTP-Referer": "https://openclaw.ai",
          "X-OpenRouter-Title": "OpenClaw",
          "X-OpenRouter-Categories": "cli-agent",
          "X-Custom": "1",
        },
      },
    ]);
  });

  it("injects cache_control markers for declared OpenRouter Anthropic models on the default route", () => {
    const payload = {
      messages: [{ role: "system", content: "system prompt" }],
    };
    const baseStreamFn: StreamFn = (model, _context, options) => {
      options?.onPayload?.(payload, model);
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterSystemCacheWrapper(baseStreamFn);
    void wrapped(
      {
        api: "openai-completions",
        provider: "openrouter",
        id: "anthropic/claude-sonnet-4.6",
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );

    expect(payload.messages[0]?.content).toEqual([
      { type: "text", text: "system prompt", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("does not inject cache_control markers for declared OpenRouter providers on custom proxy URLs", () => {
    const payload = {
      messages: [{ role: "system", content: "system prompt" }],
    };
    const baseStreamFn: StreamFn = (model, _context, options) => {
      options?.onPayload?.(payload, model);
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterSystemCacheWrapper(baseStreamFn);
    void wrapped(
      {
        api: "openai-completions",
        provider: "openrouter",
        id: "anthropic/claude-sonnet-4.6",
        baseUrl: "https://proxy.example.com/v1",
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );

    expect(payload.messages[0]?.content).toBe("system prompt");
  });

  it("injects cache_control markers for Anthropic models on DeepInfra", () => {
    const payload = {
      messages: [{ role: "system", content: "system prompt" }],
    };
    const baseStreamFn: StreamFn = (model, _context, options) => {
      options?.onPayload?.(payload, model);
      return createAssistantMessageEventStream();
    };

    const wrapped = createDeepInfraSystemCacheWrapper(baseStreamFn);
    void wrapped(
      {
        api: "openai-completions",
        provider: "deepinfra",
        id: "anthropic/claude-4-sonnet",
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );

    expect(payload.messages[0]?.content).toEqual([
      { type: "text", text: "system prompt", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("does not inject cache_control markers for non-Anthropic models on DeepInfra", () => {
    const payload = {
      messages: [{ role: "system", content: "system prompt" }],
    };
    const baseStreamFn: StreamFn = (model, _context, options) => {
      options?.onPayload?.(payload, model);
      return createAssistantMessageEventStream();
    };

    const wrapped = createDeepInfraSystemCacheWrapper(baseStreamFn);
    void wrapped(
      {
        api: "openai-completions",
        provider: "deepinfra",
        id: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );

    expect(payload.messages[0]?.content).toBe("system prompt");
  });

  it("normalizes reasoning payload for DeepInfra with thinking level", () => {
    const capturedPayloads: unknown[] = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      const payload = { messages: [] };
      options?.onPayload?.(payload, _model);
      capturedPayloads.push(payload);
      return createAssistantMessageEventStream();
    };

    const wrapped = createDeepInfraWrapper(baseStreamFn, "medium");
    void wrapped(
      {
        api: "openai-completions",
        provider: "deepinfra",
        id: "anthropic/claude-4-sonnet",
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );

    expect(capturedPayloads[0]).toEqual({
      messages: [],
      reasoning: { effort: "medium" },
    });
  });

  it("does not add reasoning payload for DeepInfra with thinking off", () => {
    const capturedPayloads: unknown[] = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      const payload = { messages: [] };
      options?.onPayload?.(payload, _model);
      capturedPayloads.push(payload);
      return createAssistantMessageEventStream();
    };

    const wrapped = createDeepInfraWrapper(baseStreamFn, "off");
    void wrapped(
      {
        api: "openai-completions",
        provider: "deepinfra",
        id: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );

    expect(capturedPayloads[0]).toEqual({ messages: [] });
  });

  it("chains DeepInfra reasoning + cache wrappers for Anthropic models", () => {
    const capturedPayloads: unknown[] = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      const payload = {
        messages: [{ role: "system", content: "system prompt" }],
      };
      options?.onPayload?.(payload, _model);
      capturedPayloads.push(payload);
      return createAssistantMessageEventStream();
    };

    // Chain as in index.ts: reasoning wrapper first, then cache wrapper
    let streamFn = createDeepInfraWrapper(baseStreamFn, "high");
    streamFn = createDeepInfraSystemCacheWrapper(streamFn);

    void streamFn(
      {
        api: "openai-completions",
        provider: "deepinfra",
        id: "anthropic/claude-4-sonnet",
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );

    const payload = capturedPayloads[0] as Record<string, unknown>;
    // Reasoning was normalized
    expect(payload.reasoning).toEqual({ effort: "high" });
    // Cache markers were injected on system message
    expect((payload.messages as Array<{ content: unknown }>)[0]?.content).toEqual([
      { type: "text", text: "system prompt", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("injects cache_control markers for native OpenRouter hosts behind custom provider ids", () => {
    const payload = {
      messages: [{ role: "system", content: "system prompt" }],
    };
    const baseStreamFn: StreamFn = (model, _context, options) => {
      options?.onPayload?.(payload, model);
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenRouterSystemCacheWrapper(baseStreamFn);
    void wrapped(
      {
        api: "openai-completions",
        provider: "custom-openrouter",
        id: "anthropic/claude-sonnet-4.6",
        baseUrl: "https://openrouter.ai/api/v1",
      } as Model<"openai-completions">,
      { messages: [] },
      {},
    );

    expect(payload.messages[0]?.content).toEqual([
      { type: "text", text: "system prompt", cache_control: { type: "ephemeral" } },
    ]);
  });
});
