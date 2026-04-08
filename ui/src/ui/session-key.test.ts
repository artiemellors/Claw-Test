import { describe, expect, it } from "vitest";
import {
  buildAgentMainSessionKey,
  buildDashboardSessionMainKey,
  resolveAgentIdFromSessionKey,
} from "./session-key.ts";

describe("buildAgentMainSessionKey", () => {
  it("keeps the selected agent in dashboard session keys", () => {
    const key = buildAgentMainSessionKey({
      agentId: "research-agent",
      mainKey: "dashboard:new-session",
    });

    expect(key).toBe("agent:research-agent:dashboard:new-session");
    expect(resolveAgentIdFromSessionKey(key)).toBe("research-agent");
  });

  it("falls back to main when the agent id is missing", () => {
    const key = buildAgentMainSessionKey({
      agentId: "",
      mainKey: "dashboard:new-session",
    });

    expect(key).toBe("agent:main:dashboard:new-session");
    expect(resolveAgentIdFromSessionKey(key)).toBe("main");
  });
});

describe("buildDashboardSessionMainKey", () => {
  it("includes a unique suffix to avoid collisions for repeated names", () => {
    const first = buildDashboardSessionMainKey({
      name: "work",
      uniqueId: "a1",
    });
    const second = buildDashboardSessionMainKey({
      name: "work",
      uniqueId: "b2",
    });

    expect(first).toBe("dashboard:work:a1");
    expect(second).toBe("dashboard:work:b2");
    expect(first).not.toBe(second);
  });

  it("normalizes spacing in session names", () => {
    const key = buildDashboardSessionMainKey({
      name: "My Session Name",
      uniqueId: "abc",
    });

    expect(key).toBe("dashboard:my-session-name:abc");
  });
});
