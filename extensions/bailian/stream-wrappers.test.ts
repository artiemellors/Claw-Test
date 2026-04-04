import { describe, expect, it } from "vitest";
import { applyBailianCacheControl } from "./stream-wrappers.js";

describe("applyBailianCacheControl", () => {
  it("tags system string content with cache_control", () => {
    const payload: Record<string, unknown> = {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
    };
    applyBailianCacheControl(payload);
    const msgs = payload.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0].content).toEqual([
      { type: "text", text: "You are a helpful assistant.", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("tags all system array content blocks with cache_control", () => {
    const payload: Record<string, unknown> = {
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: "First block" },
            { type: "text", text: "Second block" },
          ],
        },
        { role: "user", content: "Hello" },
      ],
    };
    applyBailianCacheControl(payload);
    const msgs = payload.messages as Array<{ role: string; content: unknown }>;
    const blocks = msgs[0].content as Array<Record<string, unknown>>;
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("splits system content on cache boundary", () => {
    const text = "Stable prefix\n<!-- OPENCLAW_CACHE_BOUNDARY -->\nDynamic suffix";
    const payload: Record<string, unknown> = {
      messages: [
        { role: "system", content: text },
        { role: "user", content: "Hello" },
      ],
    };
    applyBailianCacheControl(payload);
    const msgs = payload.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0].content).toEqual([
      { type: "text", text: "Stable prefix", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Dynamic suffix" },
    ]);
  });

  it("tags only the last user message", () => {
    const payload: Record<string, unknown> = {
      messages: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "Answer" },
        { role: "user", content: "Second question" },
      ],
    };
    applyBailianCacheControl(payload);
    const msgs = payload.messages as Array<{ role: string; content: unknown }>;
    // First user message should NOT have cache_control
    expect(msgs[0].content).toBe("First question");
    // Last user message should have cache_control
    expect(msgs[2].content).toEqual([
      { type: "text", text: "Second question", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("tags last user message array content last block", () => {
    const payload: Record<string, unknown> = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Part 1" },
            { type: "text", text: "Part 2" },
          ],
        },
      ],
    };
    applyBailianCacheControl(payload);
    const msgs = payload.messages as Array<{ role: string; content: unknown }>;
    const blocks = msgs[0].content as Array<Record<string, unknown>>;
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("cleans cache_control from assistant thinking blocks", () => {
    const payload: Record<string, unknown> = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "...", cache_control: { type: "ephemeral" } },
            { type: "text", text: "Answer" },
          ],
        },
        { role: "user", content: "Follow up" },
      ],
    };
    applyBailianCacheControl(payload);
    const msgs = payload.messages as Array<{ role: string; content: unknown }>;
    const blocks = msgs[0].content as Array<Record<string, unknown>>;
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it("handles empty messages", () => {
    const payload: Record<string, unknown> = { messages: [] };
    applyBailianCacheControl(payload);
    expect(payload.messages).toEqual([]);
  });

  it("handles missing messages", () => {
    const payload: Record<string, unknown> = {};
    applyBailianCacheControl(payload);
    expect(payload.messages).toBeUndefined();
  });
});
