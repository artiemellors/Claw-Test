import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { importFreshModule } from "../../test/helpers/import-fresh.js";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";
import { createSuiteTempRootTracker } from "../test-helpers/temp-dir.js";
import { createJpegBufferWithDimensions, createPngBufferWithDimensions } from "./test-helpers.js";

let loadWebMedia: typeof import("./web-media.js").loadWebMedia;
const mediaRootTracker = createSuiteTempRootTracker({
  prefix: "web-media-core-",
  parentDir: resolvePreferredOpenClawTmpDir(),
});

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

let fixtureRoot = "";
let fakePdfFile = "";
let oversizedJpegFile = "";
let realPdfFile = "";
let tinyPngFile = "";
let fakeHeicFile = "";

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.doUnmock("./image-ops.js");
  vi.doUnmock("./mime.js");
  vi.doUnmock("./ffmpeg-exec.js");
});

beforeAll(async () => {
  ({ loadWebMedia } = await import("./web-media.js"));
  await mediaRootTracker.setup();
  fixtureRoot = await mediaRootTracker.make("case");
  fakePdfFile = path.join(fixtureRoot, "fake.pdf");
  realPdfFile = path.join(fixtureRoot, "real.pdf");
  tinyPngFile = path.join(fixtureRoot, "tiny.png");
  oversizedJpegFile = path.join(fixtureRoot, "oversized.jpg");
  fakeHeicFile = path.join(fixtureRoot, "tiny.heic");
  await fs.writeFile(fakePdfFile, "TOP_SECRET_TEXT", "utf8");
  await fs.writeFile(
    realPdfFile,
    Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"),
  );
  await fs.writeFile(tinyPngFile, Buffer.from(TINY_PNG_BASE64, "base64"));
  await fs.writeFile(fakeHeicFile, Buffer.from(TINY_PNG_BASE64, "base64"));
  await fs.writeFile(
    oversizedJpegFile,
    createJpegBufferWithDimensions({ width: 6_000, height: 5_000 }),
  );
});

afterAll(async () => {
  await mediaRootTracker.cleanup();
});

describe("loadWebMedia", () => {
  function createLocalWebMediaOptions() {
    return {
      maxBytes: 1024 * 1024,
      localRoots: [fixtureRoot],
    };
  }

  async function expectRejectedWebMedia(
    url: string,
    expectedError: Record<string, unknown> | RegExp,
    setup?: () => { restore?: () => void; mockRestore?: () => void } | undefined,
  ) {
    const restoreHandle = setup?.();
    try {
      if (expectedError instanceof RegExp) {
        await expect(loadWebMedia(url, createLocalWebMediaOptions())).rejects.toThrow(
          expectedError,
        );
        return;
      }
      await expect(loadWebMedia(url, createLocalWebMediaOptions())).rejects.toMatchObject(
        expectedError,
      );
    } finally {
      restoreHandle?.mockRestore?.();
      restoreHandle?.restore?.();
    }
  }

  async function expectRejectedWebMediaWithoutFilesystemAccess(params: {
    url: string;
    expectedError: Record<string, unknown> | RegExp;
    setup?: () => { restore?: () => void; mockRestore?: () => void } | undefined;
  }) {
    const realpathSpy = vi.spyOn(fs, "realpath");
    try {
      await expectRejectedWebMedia(params.url, params.expectedError, params.setup);
      expect(realpathSpy).not.toHaveBeenCalled();
    } finally {
      realpathSpy.mockRestore();
    }
  }

  async function expectLoadedWebMediaCase(url: string) {
    const result = await loadWebMedia(url, createLocalWebMediaOptions());
    expect(result.kind).toBe("image");
    expect(result.buffer.length).toBeGreaterThan(0);
  }

  it.each([
    {
      name: "allows localhost file URLs for local files",
      createUrl: () => {
        const fileUrl = pathToFileURL(tinyPngFile);
        fileUrl.hostname = "localhost";
        return fileUrl.href;
      },
    },
  ] as const)("$name", async ({ createUrl }) => {
    await expectLoadedWebMediaCase(createUrl());
  });

  it("rejects oversized pixel-count images before decode/resize backends run", async () => {
    const oversizedPngFile = path.join(fixtureRoot, "oversized.png");
    await fs.writeFile(
      oversizedPngFile,
      createPngBufferWithDimensions({ width: 8_000, height: 4_000 }),
    );

    await expect(loadWebMedia(oversizedPngFile, createLocalWebMediaOptions())).rejects.toThrow(
      /pixel input limit/i,
    );
  });

  it("preserves pixel-limit errors for oversized JPEG optimization", async () => {
    await expect(loadWebMedia(oversizedJpegFile, createLocalWebMediaOptions())).rejects.toThrow(
      /pixel input limit/i,
    );
  });

  it.each([
    {
      name: "rejects remote-host file URLs before filesystem checks",
      url: "file://attacker/share/evil.png",
      expectedError: { code: "invalid-file-url" },
    },
    {
      name: "rejects remote-host file URLs with the explicit error message before filesystem checks",
      url: "file://attacker/share/evil.png",
      expectedError: /remote hosts are not allowed/i,
    },
    {
      name: "rejects Windows network paths before filesystem checks",
      url: "\\\\attacker\\share\\evil.png",
      expectedError: { code: "network-path-not-allowed" },
      setup: () => vi.spyOn(process, "platform", "get").mockReturnValue("win32"),
    },
  ] as const)("$name", async (testCase) => {
    await expectRejectedWebMediaWithoutFilesystemAccess(testCase);
  });

  describe("workspaceDir relative path resolution", () => {
    it("resolves a bare filename against workspaceDir", async () => {
      const result = await loadWebMedia("tiny.png", {
        ...createLocalWebMediaOptions(),
        workspaceDir: fixtureRoot,
      });
      expect(result.kind).toBe("image");
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it("resolves a dot-relative path against workspaceDir", async () => {
      const result = await loadWebMedia("./tiny.png", {
        ...createLocalWebMediaOptions(),
        workspaceDir: fixtureRoot,
      });
      expect(result.kind).toBe("image");
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it("resolves a MEDIA:-prefixed relative path against workspaceDir", async () => {
      const result = await loadWebMedia("MEDIA:tiny.png", {
        ...createLocalWebMediaOptions(),
        workspaceDir: fixtureRoot,
      });
      expect(result.kind).toBe("image");
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it("leaves absolute paths unchanged when workspaceDir is set", async () => {
      const result = await loadWebMedia(tinyPngFile, {
        ...createLocalWebMediaOptions(),
        workspaceDir: "/some/other/dir",
      });
      expect(result.kind).toBe("image");
      expect(result.buffer.length).toBeGreaterThan(0);
    });
  });

  it("normalizes HEIC local files to JPEG output", async () => {
    const result = await loadWebMedia(fakeHeicFile, createLocalWebMediaOptions());

    expect(result.kind).toBe("image");
    expect(result.contentType).toBe("image/jpeg");
    expect(result.fileName).toBe("tiny.jpg");
    expect(result.buffer[0]).toBe(0xff);
    expect(result.buffer[1]).toBe(0xd8);
  });

  it("converts parameterized HEIC mime types before JPEG optimization", async () => {
    const inputBuffer = Buffer.from("fake-heic");
    const convertedBuffer = Buffer.from("converted-jpeg-source");
    const optimizedBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const convertHeicToJpegMock = vi.fn().mockResolvedValueOnce(convertedBuffer);
    const resizeToJpegMock = vi.fn().mockResolvedValueOnce(optimizedBuffer);
    vi.doMock("./image-ops.js", async () => {
      const actual = await vi.importActual<typeof import("./image-ops.js")>("./image-ops.js");
      return {
        ...actual,
        convertHeicToJpeg: convertHeicToJpegMock,
        resizeToJpeg: resizeToJpegMock,
      };
    });
    const { optimizeImageToJpeg } = await importFreshModule<typeof import("./web-media.js")>(
      import.meta.url,
      "./web-media.js?scope=heic-mime-params",
    );

    const result = await optimizeImageToJpeg(inputBuffer, 1024, {
      contentType: "image/heic; charset=binary",
      fileName: "tiny.heic",
    });

    expect(convertHeicToJpegMock).toHaveBeenCalledWith(inputBuffer);
    expect(resizeToJpegMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: convertedBuffer,
        maxSide: 2048,
        quality: 80,
      }),
    );
    expect(result.buffer).toBe(optimizedBuffer);
  });

  it("converts HEIC files identified by extension even when the mime type is mislabeled", async () => {
    const inputBuffer = Buffer.from("fake-heic");
    const convertedBuffer = Buffer.from("converted-jpeg-source");
    const optimizedBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const convertHeicToJpegMock = vi.fn().mockResolvedValueOnce(convertedBuffer);
    const resizeToJpegMock = vi.fn().mockResolvedValueOnce(optimizedBuffer);
    vi.doMock("./image-ops.js", async () => {
      const actual = await vi.importActual<typeof import("./image-ops.js")>("./image-ops.js");
      return {
        ...actual,
        convertHeicToJpeg: convertHeicToJpegMock,
        resizeToJpeg: resizeToJpegMock,
      };
    });
    const { optimizeImageToJpeg } = await importFreshModule<typeof import("./web-media.js")>(
      import.meta.url,
      "./web-media.js?scope=heic-extension-fallback",
    );

    const result = await optimizeImageToJpeg(inputBuffer, 1024, {
      contentType: "application/octet-stream",
      fileName: "tiny.heic",
    });

    expect(convertHeicToJpegMock).toHaveBeenCalledWith(inputBuffer);
    expect(resizeToJpegMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: convertedBuffer,
        maxSide: 2048,
        quality: 80,
      }),
    );
    expect(result.buffer).toBe(optimizedBuffer);
  });

  it("relabels audio-only webm files as audio before delivery", async () => {
    const audioOnlyWebmFile = path.join(fixtureRoot, "voice.webm");
    await fs.writeFile(audioOnlyWebmFile, Buffer.from("fake-webm"));
    const detectMimeMock = vi.fn().mockResolvedValueOnce("video/webm");
    const runFfprobeMock = vi.fn().mockResolvedValueOnce("audio\n");
    vi.doMock("./mime.js", async () => {
      const actual = await vi.importActual<typeof import("./mime.js")>("./mime.js");
      return {
        ...actual,
        detectMime: detectMimeMock,
      };
    });
    vi.doMock("./ffmpeg-exec.js", async () => {
      const actual = await vi.importActual<typeof import("./ffmpeg-exec.js")>("./ffmpeg-exec.js");
      return {
        ...actual,
        runFfprobe: runFfprobeMock,
      };
    });
    const { loadWebMedia: loadFreshWebMedia } = await importFreshModule<
      typeof import("./web-media.js")
    >(import.meta.url, "./web-media.js?scope=audio-only-webm");

    const result = await loadFreshWebMedia(audioOnlyWebmFile, createLocalWebMediaOptions());

    expect(detectMimeMock).toHaveBeenCalledTimes(1);
    expect(runFfprobeMock).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("audio");
    expect(result.contentType).toBe("audio/webm");
  });

  it("does not probe remote webm URLs for stream metadata", async () => {
    const runFfprobeMock = vi.fn();
    const fetchRemoteMediaMock = vi
      .fn()
      .mockResolvedValue({ buffer: Buffer.from("fake-remote-webm"), contentType: "video/webm" });
    vi.doMock("./fetch.js", async () => {
      const actual = await vi.importActual<typeof import("./fetch.js")>("./fetch.js");
      return {
        ...actual,
        fetchRemoteMedia: fetchRemoteMediaMock,
      };
    });
    vi.doMock("./ffmpeg-exec.js", async () => {
      const actual = await vi.importActual<typeof import("./ffmpeg-exec.js")>("./ffmpeg-exec.js");
      return {
        ...actual,
        runFfprobe: runFfprobeMock,
      };
    });
    const { loadWebMedia: loadFreshWebMedia } = await importFreshModule<
      typeof import("./web-media.js")
    >(import.meta.url, "./web-media.js?scope=remote-webm");

    const result = await loadFreshWebMedia(
      "https://example.com/voice.webm",
      createLocalWebMediaOptions(),
    );

    expect(fetchRemoteMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/voice.webm" }),
    );
    expect(runFfprobeMock).not.toHaveBeenCalled();
    expect(result.kind).toBe("video");
    expect(result.contentType).toBe("video/webm");
  });

  describe("host read capability", () => {
    it("rejects document uploads that only match by file extension", async () => {
      await expect(
        loadWebMedia(fakePdfFile, {
          maxBytes: 1024 * 1024,
          localRoots: [fixtureRoot],
          hostReadCapability: true,
        }),
      ).rejects.toMatchObject({
        code: "path-not-allowed",
      });
    });

    it("still allows real PDF uploads detected from file content", async () => {
      const result = await loadWebMedia(realPdfFile, {
        maxBytes: 1024 * 1024,
        localRoots: [fixtureRoot],
        hostReadCapability: true,
      });

      expect(result.kind).toBe("document");
      expect(result.contentType).toBe("application/pdf");
      expect(result.fileName).toBe("real.pdf");
    });
  });
});
