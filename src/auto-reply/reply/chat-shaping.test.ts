import { describe, expect, it } from "vitest";
import { buildChatShapingNote, shouldApplyChatShaping } from "./chat-shaping.js";

describe("chat shaping guidance", () => {
  it("applies to short conversational follow-ups", () => {
    expect(shouldApplyChatShaping({ userText: "this okay?" })).toBe(true);
    expect(shouldApplyChatShaping({ userText: "ok!" })).toBe(true);
  });

  it("does not apply to clearly structured-output requests", () => {
    expect(shouldApplyChatShaping({ userText: "JSON output please" })).toBe(false);
    expect(shouldApplyChatShaping({ userText: "step by step instructions" })).toBe(false);
  });

  it("does not apply to dense technical payloads", () => {
    expect(shouldApplyChatShaping({ userText: "```ts\nconst x = 1\n```" })).toBe(false);
    expect(shouldApplyChatShaping({ userText: "stack trace を見て" })).toBe(false);
  });

  it("can apply to short acknowledgements when nearby thread context exists", () => {
    expect(
      shouldApplyChatShaping({
        userText: "sounds good",
        threadHistoryBody: "just updated the PR wording",
      }),
    ).toBe(true);
  });

  it("does not fast-path long substantive prompts from conversational openers", () => {
    expect(
      shouldApplyChatShaping({
        userText: "How do I refactor this module without breaking the queued reply pipeline?",
        threadHistoryBody: "we were discussing persona shaping",
      }),
    ).toBe(false);
  });

  it("does not apply broadly to arbitrary short text even with nearby context", () => {
    expect(
      shouldApplyChatShaping({
        userText: "need status summary",
        threadHistoryBody: "just updated the PR wording",
      }),
    ).toBe(false);
  });

  it("does not apply broadly in groups without nearby context", () => {
    expect(
      shouldApplyChatShaping({
        userText: "this okay?",
        isGroupChat: true,
      }),
    ).toBe(false);
  });

  it("treats thread starter as nearby context in groups", () => {
    expect(
      shouldApplyChatShaping({
        userText: "this okay?",
        isGroupChat: true,
        threadStarterBody: "proposal wording is being revised",
      }),
    ).toBe(true);
  });

  it("does not apply to long freeform requests without nearby context", () => {
    expect(
      shouldApplyChatShaping({
        userText:
          "Please summarize the current implementation status and next steps for the whole feature.",
      }),
    ).toBe(false);
  });

  it("builds a bounded shaping note", () => {
    const note = buildChatShapingNote({
      userText: "this okay?",
      replyToBody: "proposal wording is being revised",
    });

    expect(note).toContain("[Chat shaping guidance]");
    expect(note).toContain("SOUL.md and IDENTITY.md");
    expect(note).toContain("durable normal-chat behavior");
    expect(note).toContain("naturally use them in normal chat replies");
    expect(note).toContain("response-shaped openings");
    expect(note).toContain("Use bullets or headings only if they materially improve clarity");
    expect(note).toContain("bounded under the user's existing intent");
    expect(note).toContain("safety-critical");
  });
});
