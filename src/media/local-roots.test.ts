import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMediaRoot } from "./local-media-access.js";
import {
  appendLocalMediaParentRoots,
  buildMediaLocalRoots,
  getAgentScopedMediaLocalRoots,
  getAgentScopedMediaLocalRootsForSources,
  getDefaultMediaLocalRoots,
} from "./local-roots.js";

function normalizeHostPath(value: string): string {
  return path.normalize(path.resolve(value));
}

function normalizeMediaRootPath(root: LocalMediaRoot): string {
  return normalizeHostPath(typeof root === "string" ? root : root.path);
}

function asMediaRoots(roots: readonly string[]): readonly LocalMediaRoot[] {
  return roots as unknown as readonly LocalMediaRoot[];
}

describe("local media roots", () => {
  function withStateDir<T>(stateDir: string, run: () => T): T {
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    return run();
  }

  function expectNormalizedRootsContain(
    roots: readonly LocalMediaRoot[],
    expectedRoots: readonly string[],
  ) {
    const normalizedRoots = roots.map(normalizeMediaRootPath);
    expectedRoots.forEach((expectedRoot) => {
      expect(normalizedRoots).toContain(normalizeHostPath(expectedRoot));
    });
  }

  function expectNormalizedRootsExclude(
    roots: readonly LocalMediaRoot[],
    excludedRoots: readonly string[],
  ) {
    const normalizedRoots = roots.map(normalizeMediaRootPath);
    excludedRoots.forEach((excludedRoot) => {
      expect(normalizedRoots).not.toContain(normalizeHostPath(excludedRoot));
    });
  }

  function expectPicturesRootPresence(params: {
    roots: readonly LocalMediaRoot[];
    shouldContainPictures: boolean;
    picturesRoot?: string;
  }) {
    const normalizedRoots = params.roots.map(normalizeMediaRootPath);
    const picturesRoot = normalizeHostPath(params.picturesRoot ?? "/Users/peter/Pictures");
    if (params.shouldContainPictures) {
      expect(normalizedRoots).toContain(picturesRoot);
      return;
    }
    expect(normalizedRoots).not.toContain(picturesRoot);
  }

  function expectPicturesRootAbsent(roots: readonly string[], picturesRoot?: string) {
    expectPicturesRootPresence({
      roots,
      shouldContainPictures: false,
      picturesRoot,
    });
  }

  function expectAgentMediaRootsCase(params: {
    stateDir: string;
    getRoots: () => readonly LocalMediaRoot[];
    expectedContained?: readonly string[];
    expectedExcluded?: readonly string[];
    minLength?: number;
  }) {
    const roots = withStateDir(params.stateDir, params.getRoots);
    if (params.expectedContained) {
      expectNormalizedRootsContain(roots, params.expectedContained);
    }
    if (params.expectedExcluded) {
      expectNormalizedRootsExclude(roots, params.expectedExcluded);
    }
    if (params.minLength !== undefined) {
      expect(roots.length).toBeGreaterThanOrEqual(params.minLength);
    }
  }
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      name: "keeps temp, media cache, and workspace roots by default",
      stateDir: path.join("/tmp", "openclaw-media-roots-state"),
      getRoots: () => getDefaultMediaLocalRoots(),
      expectedContained: ["media", "workspace", "sandboxes"],
      expectedExcluded: ["agents"],
      minLength: 3,
    },
    {
      name: "adds the active agent workspace without re-opening broad agent state roots",
      stateDir: path.join("/tmp", "openclaw-agent-media-roots-state"),
      getRoots: () => getAgentScopedMediaLocalRoots({}, "ops"),
      expectedContained: ["workspace-ops", "sandboxes"],
      expectedExcluded: ["agents"],
    },
  ] as const)("$name", ({ stateDir, getRoots, expectedContained, expectedExcluded, minLength }) => {
    expectAgentMediaRootsCase({
      stateDir,
      getRoots,
      expectedContained: expectedContained.map((suffix) => path.join(stateDir, suffix)),
      expectedExcluded: expectedExcluded.map((suffix) => path.join(stateDir, suffix)),
      minLength,
    });
  });

  it("uses configured fs roots for direct agent-scoped media roots", () => {
    const roots = getAgentScopedMediaLocalRoots(
      {
        tools: {
          fs: {
            roots: [{ path: "/packs/shared/manual.pdf", kind: "file", access: "ro" }],
          },
        },
      },
      "ops",
    );

    expect(asMediaRoots(roots)).toEqual([
      {
        path: normalizeHostPath("/packs/shared/manual.pdf"),
        kind: "file",
        access: "ro",
      },
    ]);
  });

  it("preserves empty configured fs roots as direct deny-all media roots", () => {
    const roots = getAgentScopedMediaLocalRoots(
      {
        tools: {
          fs: {
            roots: [],
          },
        },
      },
      "ops",
    );

    expect(roots).toEqual([]);
  });

  it("adds concrete parent roots for local media sources without widening to filesystem root", () => {
    const picturesDir =
      process.platform === "win32" ? "C:\\Users\\peter\\Pictures" : "/Users/peter/Pictures";
    const moviesDir =
      process.platform === "win32" ? "C:\\Users\\peter\\Movies" : "/Users/peter/Movies";

    const roots = appendLocalMediaParentRoots(
      ["/tmp/base"],
      [
        path.join(picturesDir, "photo.png"),
        pathToFileURL(path.join(moviesDir, "clip.mp4")).href,
        "https://example.com/remote.png",
        "/top-level-file.png",
      ],
    );

    expect(roots.map(normalizeHostPath)).toEqual(
      expect.arrayContaining([
        normalizeHostPath("/tmp/base"),
        normalizeHostPath(picturesDir),
        normalizeHostPath(moviesDir),
      ]),
    );
    expect(roots.map(normalizeHostPath)).not.toContain(normalizeHostPath("/"));
  });
  it.each([
    {
      name: "widens agent media roots for concrete local sources when workspaceOnly is disabled",
      stateDir: path.join("/tmp", "openclaw-flexible-media-roots-state"),
      cfg: {},
      shouldContainPictures: true,
    },
    {
      name: "does not widen agent media roots when workspaceOnly is enabled",
      stateDir: path.join("/tmp", "openclaw-flexible-media-roots-state"),
      cfg: { tools: { fs: { workspaceOnly: true } } },
      shouldContainPictures: false,
    },
    {
      name: "does not widen media roots for messaging-profile agents without filesystem tools",
      stateDir: path.join("/tmp", "openclaw-messaging-media-roots-state"),
      cfg: { tools: { profile: "messaging" } },
      shouldContainPictures: false,
    },
    {
      name: "widens media roots again when messaging-profile agents explicitly enable filesystem tools",
      stateDir: path.join("/tmp", "openclaw-messaging-fs-media-roots-state"),
      cfg: {
        tools: {
          profile: "messaging",
          fs: { workspaceOnly: false },
        },
      },
      shouldContainPictures: true,
    },
  ] as const)("$name", ({ stateDir, cfg, shouldContainPictures }) => {
    const roots = withStateDir(stateDir, () =>
      getAgentScopedMediaLocalRootsForSources({
        cfg,
        agentId: "ops",
        mediaSources: ["/Users/peter/Pictures/photo.png"],
      }),
    );
    expectPicturesRootPresence({ roots, shouldContainPictures });
  });

  it("adds parent roots for file URLs and skips top-level paths", () => {
    const stateDir = path.join("/tmp", "openclaw-file-url-media-roots-state");
    const picturesDir =
      process.platform === "win32" ? "C:\\Users\\peter\\Pictures" : "/Users/peter/Pictures";
    const moviesDir =
      process.platform === "win32" ? "C:\\Users\\peter\\Movies" : "/Users/peter/Movies";

    const roots = withStateDir(stateDir, () =>
      getAgentScopedMediaLocalRootsForSources({
        cfg: {},
        agentId: "ops",
        mediaSources: [
          path.join(picturesDir, "photo.png"),
          pathToFileURL(path.join(moviesDir, "clip.mp4")).href,
          "/top-level-file.png",
        ],
      }),
    );

    expectNormalizedRootsContain(roots, [
      path.join(stateDir, "media"),
      path.join(stateDir, "workspace"),
      path.join(stateDir, "workspace-ops"),
    ]);
    expectPicturesRootPresence({ roots, shouldContainPictures: true, picturesRoot: picturesDir });
    expectPicturesRootPresence({ roots, shouldContainPictures: true, picturesRoot: moviesDir });
    expect(roots.map(normalizeHostPath)).not.toContain(normalizeHostPath("/"));
  });

  it("includes the config media root when legacy state and config dirs diverge", () => {
    const homeRoot = path.join(os.tmpdir(), "openclaw-legacy-home-test");
    const roots = buildMediaLocalRoots(
      path.join(homeRoot, ".clawdbot"),
      path.join(homeRoot, ".openclaw"),
    );

    expectNormalizedRootsContain(roots, [
      path.join(homeRoot, ".clawdbot", "media"),
      path.join(homeRoot, ".clawdbot", "workspace"),
      path.join(homeRoot, ".clawdbot", "sandboxes"),
      path.join(homeRoot, ".openclaw", "media"),
    ]);
  });

  it("keeps media roots strict when workspaceOnly and roots are both set", () => {
    const stateDir = path.join("/tmp", "openclaw-mixed-media-roots-state");
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);

    const strictRoots = getAgentScopedMediaLocalRootsForSources({
      cfg: {
        tools: {
          fs: {
            workspaceOnly: true,
            roots: [{ path: "/packs/shared", kind: "dir", access: "ro" }],
          },
        },
      },
      agentId: "ops",
      mediaSources: ["/Users/peter/Pictures/photo.png"],
    });

    expect(asMediaRoots(strictRoots).map(normalizeMediaRootPath)).not.toContain(
      normalizeHostPath("/Users/peter/Pictures"),
    );
  });

  it("uses configured fs roots for outbound media sources instead of widening by source parent", () => {
    const roots = getAgentScopedMediaLocalRootsForSources({
      cfg: {
        tools: {
          fs: {
            roots: [{ path: "/packs/shared/file.txt", kind: "file", access: "ro" }],
          },
        },
      },
      agentId: "ops",
      mediaSources: ["/Users/peter/Pictures/photo.png"],
    });

    expect(asMediaRoots(roots)).toEqual([
      {
        path: normalizeHostPath("/packs/shared/file.txt"),
        kind: "file",
        access: "ro",
      },
    ]);
    expect(asMediaRoots(roots).map(normalizeMediaRootPath)).not.toContain(
      normalizeHostPath("/Users/peter/Pictures"),
    );
  });

  it("preserves empty fs roots as deny-all for outbound media sources", () => {
    const roots = getAgentScopedMediaLocalRootsForSources({
      cfg: {
        tools: {
          fs: {
            roots: [],
          },
        },
      },
      agentId: "ops",
      mediaSources: ["/Users/peter/Pictures/photo.png"],
    });

    expect(roots).toEqual([]);
  });

  it("ignores configured fs roots for sandbox outbound media when requested", () => {
    const stateDir = path.join("/tmp", "openclaw-sandbox-media-roots-state");
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);

    const roots = getAgentScopedMediaLocalRootsForSources({
      cfg: {
        tools: {
          fs: {
            roots: [{ path: "/packs/shared/file.txt", kind: "file", access: "ro" }],
          },
        },
      },
      agentId: "ops",
      mediaSources: [path.join(stateDir, "sandboxes", "agent-ops", "photo.png")],
      ignoreConfiguredRoots: true,
    });

    expectNormalizedRootsContain(roots, [path.join(stateDir, "sandboxes")]);
    expect(asMediaRoots(roots).map(normalizeMediaRootPath)).not.toContain(
      normalizeHostPath("/packs/shared/file.txt"),
    );
  });
});
