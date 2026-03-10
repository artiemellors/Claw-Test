import { describe, expect, it } from "vitest";
import { parseTtsDirectives } from "./directives.js";

describe("parseTtsDirectives", () => {
  it("treats bare [[tts]] as a directive trigger", () => {
    const result = parseTtsDirectives("[[tts]]Hello world", {
      enabled: true,
      allowText: true,
      allowProvider: true,
      allowVoice: true,
      allowModelId: true,
      allowVoiceSettings: true,
      allowNormalization: true,
      allowSeed: true,
    });

    expect(result.hasDirective).toBe(true);
    expect(result.cleanedText).toBe("Hello world");
  });
});
