import { describe, expect, it } from "vitest";
import { shouldUseOptimisticNewSessionFallback } from "./app.ts";
import { GatewayRequestError } from "./gateway.ts";

describe("shouldUseOptimisticNewSessionFallback", () => {
  it("allows fallback for transport errors", () => {
    expect(shouldUseOptimisticNewSessionFallback(new Error("gateway not connected"))).toBe(true);
  });

  it("allows fallback for unavailable gateway responses", () => {
    const error = new GatewayRequestError({
      code: "UNAVAILABLE",
      message: "temporary failure",
    });
    expect(shouldUseOptimisticNewSessionFallback(error)).toBe(true);
  });

  it("allows fallback for compatibility unknown-method failures", () => {
    const error = new GatewayRequestError({
      code: "INVALID_REQUEST",
      message: "unknown method: sessions.create",
    });
    expect(shouldUseOptimisticNewSessionFallback(error)).toBe(true);
  });

  it("rejects fallback for authorization/scope failures", () => {
    const error = new GatewayRequestError({
      code: "INVALID_REQUEST",
      message: "missing scope: operator.write",
    });
    expect(shouldUseOptimisticNewSessionFallback(error)).toBe(false);
  });
});
