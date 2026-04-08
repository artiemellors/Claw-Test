import { describe, expect, it, vi } from "vitest";
import { wake } from "./service/timer.js";

describe("cron wake", () => {
  it("mode=now enqueues the system event and immediately requests heartbeat", () => {
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeatNow = vi.fn();

    const result = wake(
      {
        deps: {
          enqueueSystemEvent,
          requestHeartbeatNow,
        },
      } as never,
      { text: "dreaming-smoke", mode: "now" },
    );

    expect(result).toEqual({ ok: true });
    expect(enqueueSystemEvent).toHaveBeenCalledWith("dreaming-smoke");
    expect(requestHeartbeatNow).toHaveBeenCalledWith({ reason: "wake" });
  });

  it("mode=next-heartbeat enqueues only and does not force immediate heartbeat", () => {
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeatNow = vi.fn();

    const result = wake(
      {
        deps: {
          enqueueSystemEvent,
          requestHeartbeatNow,
        },
      } as never,
      { text: "dreaming-smoke", mode: "next-heartbeat" },
    );

    expect(result).toEqual({ ok: true });
    expect(enqueueSystemEvent).toHaveBeenCalledWith("dreaming-smoke");
    expect(requestHeartbeatNow).not.toHaveBeenCalled();
  });
});
