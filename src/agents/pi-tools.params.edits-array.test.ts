// SPDX-FileCopyrightText: Copyright (c) 2025 OpenClaw Contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  normalizeToolParams,
  assertRequiredParams,
  CLAUDE_PARAM_GROUPS,
} from "./pi-tools.params.js";

describe("normalizeToolParams — edits[] array hoisting", () => {
  it("hoists oldText and newText from edits[0] to top level", () => {
    const params = {
      file: "test.ts",
      edits: [{ oldText: "hello", newText: "world" }],
    };
    const normalized = normalizeToolParams(params);
    expect(normalized).toBeDefined();
    expect(normalized!.oldText).toBe("hello");
    expect(normalized!.newText).toBe("world");
  });

  it("does not overwrite existing top-level params with edits[] values", () => {
    const params = {
      file: "test.ts",
      oldText: "top-level",
      newText: "top-level-new",
      edits: [{ oldText: "nested", newText: "nested-new" }],
    };
    const normalized = normalizeToolParams(params);
    expect(normalized!.oldText).toBe("top-level");
    expect(normalized!.newText).toBe("top-level-new");
  });

  it("top-level aliases take precedence over nested canonical keys", () => {
    const params = {
      file: "test.ts",
      old_string: "top-level",
      new_string: "top-level-new",
      edits: [{ oldText: "nested", newText: "nested-new" }],
    };
    const normalized = normalizeToolParams(params);
    // Top-level old_string should win over nested edits[0].oldText
    expect(normalized!.oldText).toBe("top-level");
    expect(normalized!.newText).toBe("top-level-new");
  });

  it("handles edits[] with alias keys (old_string, new_string)", () => {
    const params = {
      file: "test.ts",
      edits: [{ old_string: "hello", new_string: "world" }],
    };
    const normalized = normalizeToolParams(params);
    // Alias normalization runs on edits[0] values after hoisting
    expect(normalized!.oldText).toBe("hello");
    expect(normalized!.newText).toBe("world");
  });

  it("ignores empty edits array", () => {
    const params = {
      file: "test.ts",
      edits: [],
    };
    const normalized = normalizeToolParams(params);
    expect(normalized).toBeDefined();
    expect(normalized!.oldText).toBeUndefined();
  });

  it("passes assertRequiredParams after edits[] hoisting", () => {
    const params = {
      file: "test.ts",
      edits: [{ oldText: "hello", newText: "world" }],
    };
    const normalized = normalizeToolParams(params);
    expect(() => {
      assertRequiredParams(normalized, CLAUDE_PARAM_GROUPS.edit, "edit");
    }).not.toThrow();
  });

  it("still fails assertRequiredParams when edits[] has no oldText/newText", () => {
    const params = {
      file: "test.ts",
      edits: [{ unrelated: "value" }],
    };
    const normalized = normalizeToolParams(params);
    expect(() => {
      assertRequiredParams(normalized, CLAUDE_PARAM_GROUPS.edit, "edit");
    }).toThrow(/Missing required/);
  });

  it("does not produce duplicate edits after hoisting from edits[0]", () => {
    const params = {
      file: "test.ts",
      edits: [{ oldText: "hello", newText: "world" }],
    };
    const normalized = normalizeToolParams(params);
    // After hoisting, edits array should be removed to prevent
    // normalizeEditReplacements from creating a duplicate entry.
    const edits = normalized!.edits as Array<{ oldText: string; newText: string }> | undefined;
    if (edits) {
      const dupes = edits.filter((e) => e.oldText === "hello" && e.newText === "world");
      expect(dupes.length).toBeLessThanOrEqual(1);
    }
  });
});
