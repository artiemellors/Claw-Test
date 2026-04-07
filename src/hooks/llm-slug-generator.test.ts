import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const runCliAgentMock = vi.fn();
const runEmbeddedPiAgentMock = vi.fn();

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: () => "main",
  resolveAgentWorkspaceDir: () => path.join(os.tmpdir(), "openclaw-slug-workspace"),
  resolveAgentDir: () => path.join(os.tmpdir(), "openclaw-slug-agent"),
  resolveAgentEffectiveModelPrimary: () => "claude-cli/opus",
}));

vi.mock("../agents/cli-runner.js", () => ({
  runCliAgent: (params: unknown) => runCliAgentMock(params),
}));

vi.mock("../agents/pi-embedded.js", () => ({
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

const { generateSlugViaLLM } = await import("./llm-slug-generator.js");

describe("generateSlugViaLLM CLI backend dispatch", () => {
  beforeEach(() => {
    runCliAgentMock.mockReset();
    runEmbeddedPiAgentMock.mockReset();
  });

  it("uses runCliAgent for CLI-backed default models", async () => {
    runCliAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "Vendor Pitch" }],
      meta: {
        agentMeta: {
          sessionId: "cli-session",
          provider: "claude-cli",
          model: "opus",
        },
      },
    });

    const slug = await generateSlugViaLLM({
      sessionContent: "Discussed the vendor pitch and next steps.",
      cfg: {
        agents: {
          defaults: {
            cliBackends: {
              "claude-cli": { command: "claude" },
            },
          },
        },
      } as OpenClawConfig,
    });

    expect(runCliAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-cli",
        model: "opus",
      }),
    );
    expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
    expect(slug).toBe("vendor-pitch");
  });
});
