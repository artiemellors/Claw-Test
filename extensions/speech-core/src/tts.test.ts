import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const { runFfmpegMock } = vi.hoisted(() => ({
  runFfmpegMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/media-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/media-runtime")>(
    "openclaw/plugin-sdk/media-runtime",
  );
  return {
    ...actual,
    runFfmpeg: (...args: Parameters<typeof actual.runFfmpeg>) => runFfmpegMock(...args),
  };
});

describe("maybeNormalizeVoiceBubbleAudio", () => {
  it("transcodes webm voice-note audio to ogg for WhatsApp delivery", async () => {
    const { _test } = await import("./tts.js");
    runFfmpegMock.mockResolvedValueOnce("");

    const result = await _test.maybeNormalizeVoiceBubbleAudio({
      audioPath: "/tmp/reply.webm",
      channelId: "whatsapp",
    });

    expect(result).toBe("/tmp/reply.ogg");
    expect(runFfmpegMock).toHaveBeenCalledWith(
      expect.arrayContaining(["-i", "/tmp/reply.webm", path.join("/tmp", "reply.ogg")]),
    );
  });

  it("keeps non-webm audio unchanged", async () => {
    const { _test } = await import("./tts.js");

    const result = await _test.maybeNormalizeVoiceBubbleAudio({
      audioPath: "/tmp/reply.mp3",
      channelId: "whatsapp",
    });

    expect(result).toBe("/tmp/reply.mp3");
    expect(runFfmpegMock).not.toHaveBeenCalled();
  });
});
