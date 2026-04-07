import { describe, expect, it } from "vitest";
import { buildAgentMainSessionKey, resolveAgentIdFromSessionKey } from "./session-key.ts";

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
