import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  createAgentScopedHostMediaReadFile,
  resolveAgentScopedOutboundMediaAccess,
} from "./read-capability.js";

describe("createAgentScopedHostMediaReadFile", () => {
  it("returns undefined when tools.fs.roots is configured", () => {
    const result = createAgentScopedHostMediaReadFile({
      cfg: {
        tools: {
          fs: {
            roots: [{ path: "/data/shared", kind: "dir", access: "ro" }],
          },
        },
      } as OpenClawConfig,
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when tools.fs.roots is empty (deny-all)", () => {
    const result = createAgentScopedHostMediaReadFile({
      cfg: {
        tools: {
          fs: {
            roots: [],
          },
        },
      } as OpenClawConfig,
    });

    expect(result).toBeUndefined();
  });
});

describe("resolveAgentScopedOutboundMediaAccess", () => {
  it("preserves caller-provided workspaceDir from mediaAccess", () => {
    const result = resolveAgentScopedOutboundMediaAccess({
      cfg: {} as OpenClawConfig,
      mediaAccess: { workspaceDir: "/tmp/media-workspace" },
    });

    expect(result).toMatchObject({ workspaceDir: "/tmp/media-workspace" });
  });

  it("preserves empty localRoots as deny-all when tools.fs.roots is []", () => {
    const result = resolveAgentScopedOutboundMediaAccess({
      cfg: {
        tools: {
          fs: {
            roots: [],
          },
        },
      } as OpenClawConfig,
    });

    expect(result).toHaveProperty("localRoots");
    expect(result.localRoots).toEqual([]);
    expect(result.readFile).toBeUndefined();
  });

  it("prefers explicit workspaceDir over mediaAccess.workspaceDir", () => {
    const result = resolveAgentScopedOutboundMediaAccess({
      cfg: {} as OpenClawConfig,
      workspaceDir: "/tmp/explicit-workspace",
      mediaAccess: { workspaceDir: "/tmp/media-workspace" },
    });

    expect(result).toMatchObject({ workspaceDir: "/tmp/explicit-workspace" });
  });
});
