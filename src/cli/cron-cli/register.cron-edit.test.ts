/**
 * Unit tests for computeDisplayAfterSchedule (cron edit diff preview).
 *
 * These tests verify that the preview accurately mirrors applyJobPatch merge
 * semantics, in particular for staggerMs inheritance and synthesis.
 */
import { describe, expect, it } from "vitest";

// Re-export the private helper for testing via a thin wrapper.
// We import the register module and extract via a test-only export shim.
// Since computeDisplayAfterSchedule is not exported, we test it indirectly
// through buildCronPatchDiff by capturing stderr output, OR we expose it
// via a named export added for test purposes.
//
// For now, test through the observable diff output produced by the module.
// The key invariant: cron→cron edits that omit staggerMs must NOT add a
// synthesized staggerMs entry in the diff preview.

import { beforeEach, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  listMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("../../cron/client.js", () => ({
  createCronClient: () => ({
    list: hoisted.listMock,
    update: hoisted.updateMock,
  }),
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  },
}));

const makeExistingCronJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  agentId: "main",
  name: "My Job",
  enabled: true,
  schedule: { kind: "cron", expr: "0 9 * * *" },
  payload: { model: "default" },
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe("cron edit diff preview — stagger synthesis", () => {
  beforeEach(() => {
    hoisted.listMock.mockReset();
    hoisted.updateMock.mockReset();
  });

  it("does NOT synthesize staggerMs in preview when editing cron→cron and existing job has no staggerMs", async () => {
    // Regression test for: https://github.com/openclaw/openclaw/pull/59597
    // chatgpt-codex-connector comment 3031692227
    //
    // Before fix: computeDisplayAfterSchedule fell through to Path 2 (non-cron→cron
    // synthesis) when existing.staggerMs was undefined, showing a spurious stagger
    // in the diff even though cron.update would not persist it.
    //
    // After fix: Path 1 now matches on e["kind"] === "cron" regardless of whether
    // staggerMs is defined, returning the patch unchanged (no synthesis).

    const existingJob = makeExistingCronJob({
      // Deliberately no staggerMs on the existing schedule
      schedule: { kind: "cron", expr: "0 9 * * *" },
    });

    hoisted.listMock.mockResolvedValue([existingJob]);
    // updateMock intentionally rejects — we only care about the diff preview
    // printed before the update call, not the update result itself.
    hoisted.updateMock.mockRejectedValue(new Error("update-rejected-in-test"));

    // Capture stderr output (where the diff preview is printed)
    const stderrLines: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        if (typeof chunk === "string") stderrLines.push(chunk);
        else if (Buffer.isBuffer(chunk)) stderrLines.push(chunk.toString());
        return true;
      });

    let caughtError: unknown;
    try {
      const { registerCronEdit } = await import("./register.cron-edit.js");
      const { defaultRuntime } = await import("../../runtime.js");

      await registerCronEdit(
        ["cron", "edit", "job-1", "--cron", "0 10 * * *"],
        defaultRuntime,
      );
    } catch (err) {
      caughtError = err;
    } finally {
      stderrSpy.mockRestore();
    }

    // Verify the code path actually executed: listMock must have been called.
    // If registerCronEdit threw before reaching the list call (e.g. import error),
    // the test would be a false positive without this assertion.
    expect(hoisted.listMock).toHaveBeenCalled();

    // Only swallow the expected update-mock rejection; re-throw anything else.
    if (
      caughtError !== undefined &&
      !(caughtError instanceof Error && caughtError.message === "update-rejected-in-test")
    ) {
      throw caughtError;
    }

    const diffOutput = stderrLines.join("\n");

    // The preview must NOT mention stagger when the patch doesn't change it
    // and the existing job has no staggerMs defined.
    expect(diffOutput).not.toMatch(/stagger/i);
  });

  it("preserves existing staggerMs in preview for cron→cron when job has a defined staggerMs", async () => {
    const existingJob = makeExistingCronJob({
      schedule: { kind: "cron", expr: "0 9 * * *", staggerMs: 120_000 },
    });

    hoisted.listMock.mockResolvedValue([existingJob]);
    // updateMock intentionally rejects — we only care about the diff preview
    // printed before the update call, not the update result itself.
    hoisted.updateMock.mockRejectedValue(new Error("update-rejected-in-test"));

    const stderrLines: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        if (typeof chunk === "string") stderrLines.push(chunk);
        else if (Buffer.isBuffer(chunk)) stderrLines.push(chunk.toString());
        return true;
      });

    let caughtError: unknown;
    try {
      const { registerCronEdit } = await import("./register.cron-edit.js");
      const { defaultRuntime } = await import("../../runtime.js");

      await registerCronEdit(
        ["cron", "edit", "job-1", "--cron", "0 10 * * *"],
        defaultRuntime,
      );
    } catch (err) {
      caughtError = err;
    } finally {
      stderrSpy.mockRestore();
    }

    // Verify the code path actually executed: listMock must have been called.
    expect(hoisted.listMock).toHaveBeenCalled();

    // Only swallow the expected update-mock rejection; re-throw anything else.
    if (
      caughtError !== undefined &&
      !(caughtError instanceof Error && caughtError.message === "update-rejected-in-test")
    ) {
      throw caughtError;
    }

    // The existing staggerMs (120_000 ms = 2m) should be reflected in the
    // after-value (unchanged), not silently dropped or synthesized anew.
    const diffOutput = stderrLines.join("\n");
    // schedule line should not show staggerMs as changed if only expr changed
    // (stagger is preserved, so it should appear equal on both sides if shown at all)
    // We just verify no "→" diff line surfaces for staggerMs.
    const staggerDiffLine = diffOutput
      .split("\n")
      .find((l) => l.includes("stagger") && l.includes("→"));
    expect(staggerDiffLine).toBeUndefined();
  });
});
