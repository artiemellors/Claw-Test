import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { TemplateContext } from "../templating.js";
import { resolveMemoryFlushResetAtHour } from "./agent-runner-memory.js";
import { resolveMemoryFlushRelativePathForRun } from "./memory-flush.js";

const DIRECT_SESSION_CONTEXT = {
  Provider: "whatsapp",
  OriginatingChannel: "telegram",
  ChatType: "direct",
} as unknown as TemplateContext;

describe("resolveMemoryFlushResetAtHour", () => {
  it("uses the direct session daily reset boundary", () => {
    const cfg = {
      session: {
        reset: {
          atHour: 4,
        },
      },
    } as OpenClawConfig;

    expect(
      resolveMemoryFlushResetAtHour({
        cfg,
        sessionCtx: DIRECT_SESSION_CONTEXT,
        sessionKey: "main",
      }),
    ).toBe(4);
  });

  it("skips reset-cycle day keys for non-daily reset policies", () => {
    const cfg = {
      session: {
        reset: {
          mode: "idle",
          idleMinutes: 30,
        },
      },
    } as OpenClawConfig;

    expect(
      resolveMemoryFlushResetAtHour({
        cfg,
        sessionCtx: DIRECT_SESSION_CONTEXT,
        sessionKey: "main",
      }),
    ).toBeUndefined();
  });

  it("uses the reset-cycle day key before the daily reset hour", () => {
    const cfg = {
      agents: {
        defaults: {
          userTimezone: "Asia/Shanghai",
        },
      },
      session: {
        reset: {
          atHour: 4,
        },
      },
    } as OpenClawConfig;

    const resetAtHour = resolveMemoryFlushResetAtHour({
      cfg,
      sessionCtx: DIRECT_SESSION_CONTEXT,
      sessionKey: "main",
    });

    expect(
      resolveMemoryFlushRelativePathForRun({
        cfg,
        nowMs: Date.UTC(2026, 2, 20, 17, 10, 0), // 2026-03-21 01:10 +08:00
        resetAtHour,
      }),
    ).toBe("memory/2026-03-20.md");
  });
});
