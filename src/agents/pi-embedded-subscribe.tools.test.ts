import { describe, expect, it } from "vitest";
import { extractToolErrorMessage, isWarningOnlyToolResult } from "./pi-embedded-subscribe.tools.js";

describe("extractToolErrorMessage", () => {
  it("ignores non-error status values", () => {
    expect(extractToolErrorMessage({ details: { status: "0" } })).toBeUndefined();
    expect(extractToolErrorMessage({ details: { status: "completed" } })).toBeUndefined();
    expect(extractToolErrorMessage({ details: { status: "ok" } })).toBeUndefined();
  });

  it("keeps error-like status values", () => {
    expect(extractToolErrorMessage({ details: { status: "failed" } })).toBe("failed");
    expect(extractToolErrorMessage({ details: { status: "timeout" } })).toBe("timeout");
  });
});

describe("isWarningOnlyToolResult", () => {
  it("detects warning at the top level", () => {
    expect(isWarningOnlyToolResult({ warning: "soft fail" })).toBe(true);
  });

  it("detects warning inside details (jsonResult shape)", () => {
    // This is the shape produced by jsonResult({ ok: false, warning: "..." })
    expect(
      isWarningOnlyToolResult({
        content: [{ type: "text", text: '{"ok":false,"warning":"reaction limit"}' }],
        details: { ok: false, warning: "reaction limit" },
      }),
    ).toBe(true);
  });

  it("rejects when details contains a hard error alongside warning", () => {
    expect(
      isWarningOnlyToolResult({
        details: { warning: "soft", error: "hard failure" },
      }),
    ).toBe(false);
  });

  it("rejects when there is no warning at all", () => {
    expect(isWarningOnlyToolResult({ details: { ok: true } })).toBe(false);
    expect(isWarningOnlyToolResult({})).toBe(false);
    expect(isWarningOnlyToolResult(null)).toBe(false);
  });

  it("prefers top-level warning and still checks details for errors", () => {
    expect(
      isWarningOnlyToolResult({ warning: "w", details: { error: "e" } }),
    ).toBe(false);
  });
});
