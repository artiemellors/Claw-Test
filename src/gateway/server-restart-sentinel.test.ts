import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeMockedModule } from "../test-utils/vitest-module-mocks.js";

const mocks = vi.hoisted(() => ({
  resolveSessionAgentId: vi.fn(() => "agent-from-key"),
  consumeRestartSentinel: vi.fn(async () => ({
    payload: {
      sessionKey: "agent:main:main",
      deliveryContext: {
        channel: "whatsapp",
        to: "+15550002",
        accountId: "acct-2",
      },
    },
  })),
  formatRestartSentinelMessage: vi.fn(() => "restart message"),
  summarizeRestartSentinel: vi.fn(() => "restart summary"),
  resolveMainSessionKeyFromConfig: vi.fn(() => "agent:main:main"),
  parseSessionThreadInfo: vi.fn(() => ({ baseSessionKey: null, threadId: undefined })),
  loadSessionEntry: vi.fn(() => ({
    cfg: {},
    entry: {},
    storePath: "/tmp/sessions.json",
    canonicalKey: "agent:main:main",
  })),
  resolveAnnounceTargetFromKey: vi.fn(() => null),
  deliveryContextFromSession: vi.fn(() => undefined),
  mergeDeliveryContext: vi.fn((a?: Record<string, unknown>, b?: Record<string, unknown>) => ({
    ...b,
    ...a,
  })),
  getChannelPlugin: vi.fn(() => undefined),
  normalizeChannelId: vi.fn((channel: string) => channel),
  resolveOutboundTarget: vi.fn((() => ({ ok: true as const, to: "+15550002" })) as (
    ...args: never[]
  ) => { ok: true; to: string } | { ok: false; error: Error }),
  deliverOutboundPayloads: vi.fn(async () => [{ channel: "whatsapp", messageId: "msg-1" }]),
  enqueueDelivery: vi.fn(async () => "queue-1"),
  ackDelivery: vi.fn(async () => {}),
  failDelivery: vi.fn(async () => {}),
  enqueueSystemEvent: vi.fn(),
  requestHeartbeatNow: vi.fn(),
  injectTimestamp: vi.fn((message: string) => `stamped:${message}`),
  timestampOptsFromConfig: vi.fn(() => ({})),
  recordInboundSessionAndDispatchReply: vi.fn(async () => {}),
  logWarn: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveSessionAgentId: mocks.resolveSessionAgentId,
}));

vi.mock("../infra/restart-sentinel.js", () => ({
  consumeRestartSentinel: mocks.consumeRestartSentinel,
  formatRestartSentinelMessage: mocks.formatRestartSentinelMessage,
  summarizeRestartSentinel: mocks.summarizeRestartSentinel,
}));

vi.mock("../config/sessions.js", () => ({
  resolveMainSessionKeyFromConfig: mocks.resolveMainSessionKeyFromConfig,
}));

vi.mock("../config/sessions/thread-info.js", () => ({
  parseSessionThreadInfo: mocks.parseSessionThreadInfo,
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: mocks.loadSessionEntry,
}));

vi.mock("../agents/tools/sessions-send-helpers.js", () => ({
  resolveAnnounceTargetFromKey: mocks.resolveAnnounceTargetFromKey,
}));

vi.mock("../utils/delivery-context.js", () => ({
  deliveryContextFromSession: mocks.deliveryContextFromSession,
  mergeDeliveryContext: mocks.mergeDeliveryContext,
}));

vi.mock("../channels/plugins/index.js", () => ({
  getChannelPlugin: mocks.getChannelPlugin,
  normalizeChannelId: mocks.normalizeChannelId,
}));

vi.mock("../infra/outbound/targets.js", () => ({
  resolveOutboundTarget: mocks.resolveOutboundTarget,
}));

vi.mock("../infra/outbound/deliver.js", () => ({
  deliverOutboundPayloads: mocks.deliverOutboundPayloads,
}));

vi.mock("../infra/outbound/delivery-queue.js", () => ({
  enqueueDelivery: mocks.enqueueDelivery,
  ackDelivery: mocks.ackDelivery,
  failDelivery: mocks.failDelivery,
}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: mocks.enqueueSystemEvent,
}));

vi.mock("../plugin-sdk/inbound-reply-dispatch.js", () => ({
  recordInboundSessionAndDispatchReply: mocks.recordInboundSessionAndDispatchReply,
}));

vi.mock("../infra/heartbeat-wake.js", async () => {
  return await mergeMockedModule(
    await vi.importActual<typeof import("../infra/heartbeat-wake.js")>(
      "../infra/heartbeat-wake.js",
    ),
    () => ({
      requestHeartbeatNow: mocks.requestHeartbeatNow,
    }),
  );
});

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: vi.fn(() => ({
    warn: mocks.logWarn,
  })),
}));

vi.mock("./server-methods/agent-timestamp.js", () => ({
  injectTimestamp: mocks.injectTimestamp,
  timestampOptsFromConfig: mocks.timestampOptsFromConfig,
}));

const { scheduleRestartSentinelWake } = await import("./server-restart-sentinel.js");

describe("scheduleRestartSentinelWake", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useRealTimers();
    mocks.consumeRestartSentinel.mockResolvedValue({
      payload: {
        sessionKey: "agent:main:main",
        deliveryContext: {
          channel: "whatsapp",
          to: "+15550002",
          accountId: "acct-2",
        },
      },
    });
    mocks.loadSessionEntry.mockReset();
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      entry: {},
      storePath: "/tmp/sessions.json",
      canonicalKey: "agent:main:main",
    });
    mocks.deliverOutboundPayloads.mockReset();
    mocks.deliverOutboundPayloads.mockResolvedValue([{ channel: "whatsapp", messageId: "msg-1" }]);
    mocks.enqueueDelivery.mockReset();
    mocks.enqueueDelivery.mockResolvedValue("queue-1");
    mocks.ackDelivery.mockClear();
    mocks.failDelivery.mockClear();
    mocks.enqueueSystemEvent.mockClear();
    mocks.requestHeartbeatNow.mockClear();
    mocks.injectTimestamp.mockClear();
    mocks.timestampOptsFromConfig.mockClear();
    mocks.recordInboundSessionAndDispatchReply.mockReset();
    mocks.recordInboundSessionAndDispatchReply.mockResolvedValue(undefined);
    mocks.logWarn.mockClear();
  });

  it("enqueues the sentinel note and wakes the session even when outbound delivery succeeds", async () => {
    const deps = {} as never;

    await scheduleRestartSentinelWake({ deps });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        to: "+15550002",
        session: { key: "agent:main:main", agentId: "agent-from-key" },
        deps,
        bestEffort: false,
        skipQueue: true,
      }),
    );
    expect(mocks.enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        to: "+15550002",
        payloads: [{ text: "restart message" }],
        bestEffort: false,
      }),
    );
    expect(mocks.ackDelivery).toHaveBeenCalledWith("queue-1");
    expect(mocks.failDelivery).not.toHaveBeenCalled();
    expect(mocks.enqueueSystemEvent).toHaveBeenCalledWith(
      "restart message",
      expect.objectContaining({
        sessionKey: "agent:main:main",
      }),
    );
    expect(mocks.requestHeartbeatNow).toHaveBeenCalledWith({
      reason: "wake",
      sessionKey: "agent:main:main",
    });
    expect(mocks.recordInboundSessionAndDispatchReply).not.toHaveBeenCalled();
    expect(mocks.logWarn).not.toHaveBeenCalled();
  });

  it("retries outbound delivery once and logs a warning without dropping the agent wake", async () => {
    vi.useFakeTimers();
    mocks.deliverOutboundPayloads
      .mockRejectedValueOnce(new Error("transport not ready"))
      .mockResolvedValueOnce([{ channel: "whatsapp", messageId: "msg-2" }]);

    const wakePromise = scheduleRestartSentinelWake({ deps: {} as never });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(750);
    await wakePromise;

    expect(mocks.enqueueDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledTimes(2);
    expect(mocks.deliverOutboundPayloads).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        skipQueue: true,
      }),
    );
    expect(mocks.deliverOutboundPayloads).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        skipQueue: true,
      }),
    );
    expect(mocks.ackDelivery).toHaveBeenCalledWith("queue-1");
    expect(mocks.failDelivery).not.toHaveBeenCalled();
    expect(mocks.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(mocks.requestHeartbeatNow).toHaveBeenCalledTimes(1);
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("retrying in 750ms"),
      expect.objectContaining({
        channel: "whatsapp",
        to: "+15550002",
        sessionKey: "agent:main:main",
        attempt: 1,
        maxAttempts: 2,
      }),
    );
  });

  it("keeps one queued restart notice when outbound retries are exhausted", async () => {
    vi.useFakeTimers();
    mocks.deliverOutboundPayloads
      .mockRejectedValueOnce(new Error("transport not ready"))
      .mockRejectedValueOnce(new Error("transport still not ready"));

    const wakePromise = scheduleRestartSentinelWake({ deps: {} as never });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(750);
    await wakePromise;

    expect(mocks.enqueueDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledTimes(2);
    expect(mocks.ackDelivery).not.toHaveBeenCalled();
    expect(mocks.failDelivery).toHaveBeenCalledWith("queue-1", "transport still not ready");
  });

  it("prefers top-level sentinel threadId for wake routing context", async () => {
    // Legacy or malformed sentinel JSON can still carry a nested threadId.
    mocks.consumeRestartSentinel.mockResolvedValue({
      payload: {
        sessionKey: "agent:main:main",
        deliveryContext: {
          channel: "whatsapp",
          to: "+15550002",
          accountId: "acct-2",
          threadId: "stale-thread",
        } as never,
        threadId: "fresh-thread",
      },
    } as Awaited<ReturnType<typeof mocks.consumeRestartSentinel>>);

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.enqueueSystemEvent).toHaveBeenCalledWith(
      "restart message",
      expect.objectContaining({
        sessionKey: "agent:main:main",
        deliveryContext: expect.objectContaining({
          threadId: "fresh-thread",
        }),
      }),
    );
  });

  it("dispatches agentTurn continuation after the restart notice in the same routed thread", async () => {
    mocks.consumeRestartSentinel.mockResolvedValue({
      payload: {
        sessionKey: "agent:main:main",
        deliveryContext: {
          channel: "whatsapp",
          to: "+15550002",
          accountId: "acct-2",
        },
        threadId: "thread-42",
        ts: 123,
        continuation: {
          kind: "agentTurn",
          message: "Reply with exactly: Yay! I did it!",
        },
      },
    } as Awaited<ReturnType<typeof mocks.consumeRestartSentinel>>);

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        payloads: [{ text: "restart message" }],
        threadId: "thread-42",
      }),
    );
    expect(mocks.recordInboundSessionAndDispatchReply).toHaveBeenCalledTimes(1);
    expect(mocks.recordInboundSessionAndDispatchReply).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        accountId: "acct-2",
        routeSessionKey: "agent:main:main",
        ctxPayload: expect.objectContaining({
          Body: "Reply with exactly: Yay! I did it!",
          BodyForAgent: "stamped:Reply with exactly: Yay! I did it!",
          SessionKey: "agent:main:main",
          OriginatingChannel: "whatsapp",
          OriginatingTo: "+15550002",
          ExplicitDeliverRoute: true,
          MessageThreadId: "thread-42",
        }),
      }),
    );
  });

  it("logs and continues when continuation delivery fails", async () => {
    mocks.consumeRestartSentinel.mockResolvedValue({
      payload: {
        sessionKey: "agent:main:main",
        deliveryContext: {
          channel: "whatsapp",
          to: "+15550002",
          accountId: "acct-2",
        },
        ts: 123,
        continuation: {
          kind: "agentTurn",
          message: "continue",
        },
      },
    } as Awaited<ReturnType<typeof mocks.consumeRestartSentinel>>);
    mocks.recordInboundSessionAndDispatchReply.mockRejectedValueOnce(new Error("dispatch failed"));

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.enqueueSystemEvent).toHaveBeenCalledWith(
      "restart message",
      expect.objectContaining({
        sessionKey: "agent:main:main",
      }),
    );
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("continuation delivery failed"),
      expect.objectContaining({
        sessionKey: "agent:main:main",
        continuationKind: "agentTurn",
      }),
    );
  });

  it("warns and skips agentTurn continuation when restart routing cannot resolve a destination", async () => {
    mocks.consumeRestartSentinel.mockResolvedValue({
      payload: {
        sessionKey: "agent:main:main",
        deliveryContext: {
          channel: "whatsapp",
          to: "+15550002",
          accountId: "acct-2",
        },
        ts: 123,
        continuation: {
          kind: "agentTurn",
          message: "continue",
        },
      },
    } as Awaited<ReturnType<typeof mocks.consumeRestartSentinel>>);
    mocks.resolveOutboundTarget.mockReturnValueOnce({
      ok: false,
      error: new Error("missing route"),
    });

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.recordInboundSessionAndDispatchReply).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("restart continuation route unavailable"),
      expect.objectContaining({
        sessionKey: "agent:main:main",
        continuationKind: "agentTurn",
      }),
    );
  });

  it("consumes continuation once and does not replay it on later startup cycles", async () => {
    mocks.consumeRestartSentinel
      .mockResolvedValueOnce({
        payload: {
          sessionKey: "agent:main:main",
          deliveryContext: {
            channel: "whatsapp",
            to: "+15550002",
            accountId: "acct-2",
          },
          ts: 123,
          continuation: {
            kind: "agentTurn",
            message: "continue",
          },
        },
      } as Awaited<ReturnType<typeof mocks.consumeRestartSentinel>>)
      .mockResolvedValueOnce(
        null as unknown as Awaited<ReturnType<typeof mocks.consumeRestartSentinel>>,
      );

    await scheduleRestartSentinelWake({ deps: {} as never });
    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.recordInboundSessionAndDispatchReply).toHaveBeenCalledTimes(1);
  });

  it("does not wake the main session when the sentinel has no sessionKey", async () => {
    mocks.consumeRestartSentinel.mockResolvedValue({
      payload: {
        message: "restart message",
      },
    } as unknown as Awaited<ReturnType<typeof mocks.consumeRestartSentinel>>);

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.enqueueSystemEvent).toHaveBeenCalledWith("restart message", {
      sessionKey: "agent:main:main",
    });
    expect(mocks.requestHeartbeatNow).not.toHaveBeenCalled();
    expect(mocks.deliverOutboundPayloads).not.toHaveBeenCalled();
  });

  it("warns when continuation cannot run because the restart sentinel has no sessionKey", async () => {
    mocks.consumeRestartSentinel.mockResolvedValue({
      payload: {
        message: "restart message",
        continuation: {
          kind: "agentTurn",
          message: "continue",
        },
      },
    } as unknown as Awaited<ReturnType<typeof mocks.consumeRestartSentinel>>);

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.enqueueSystemEvent).toHaveBeenCalledWith("restart message", {
      sessionKey: "agent:main:main",
    });
    expect(mocks.recordInboundSessionAndDispatchReply).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("continuation skipped"),
      expect.objectContaining({
        sessionKey: "agent:main:main",
        continuationKind: "agentTurn",
      }),
    );
  });
});
