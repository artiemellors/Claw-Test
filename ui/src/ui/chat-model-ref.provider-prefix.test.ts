import { describe, expect, it } from "vitest";
import { buildChatModelOption, resolveServerChatModelValue } from "./chat-model-ref.ts";

describe("chat-model-ref provider prefix handling", () => {
  it("prefixes provider-owned slash model ids when building option values", () => {
    expect(
      buildChatModelOption({
        id: "deepseek-ai/deepseek-v3.2",
        name: "DeepSeek V3.2",
        provider: "nvidia",
      }),
    ).toEqual({
      value: "nvidia/deepseek-ai/deepseek-v3.2",
      label: "deepseek-ai/deepseek-v3.2 · nvidia",
    });
    expect(
      buildChatModelOption({
        id: "anthropic/claude-haiku-4.5",
        name: "Claude Haiku 4.5",
        provider: "openrouter",
      }),
    ).toEqual({
      value: "openrouter/anthropic/claude-haiku-4.5",
      label: "anthropic/claude-haiku-4.5 · openrouter",
    });
  });

  it("still preserves already-qualified server model refs when the provider is stale", () => {
    expect(resolveServerChatModelValue("ollama/qwen3:30b", "openai-codex")).toBe(
      "ollama/qwen3:30b",
    );
  });
});
