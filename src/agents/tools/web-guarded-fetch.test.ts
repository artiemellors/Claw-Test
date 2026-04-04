import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithSsrFGuard, GUARDED_FETCH_MODE } from "../../infra/net/fetch-guard.js";
import {
  fetchWithWebToolsNetworkGuard,
  withStrictWebToolsEndpoint,
  withTrustedWebToolsEndpoint,
} from "./web-guarded-fetch.js";

vi.mock("../../infra/net/fetch-guard.js", () => {
  const GUARDED_FETCH_MODE = {
    STRICT: "strict",
    TRUSTED_ENV_PROXY: "trusted_env_proxy",
  } as const;
  return {
    GUARDED_FETCH_MODE,
    fetchWithSsrFGuard: vi.fn(),
    withStrictGuardedFetchMode: (params: Record<string, unknown>) => ({
      ...params,
      mode: GUARDED_FETCH_MODE.STRICT,
    }),
    withTrustedEnvProxyGuardedFetchMode: (params: Record<string, unknown>) => ({
      ...params,
      mode: GUARDED_FETCH_MODE.TRUSTED_ENV_PROXY,
    }),
  };
});

describe("web-guarded-fetch", () => {
  const priorHttpProxy = process.env.HTTP_PROXY;
  const priorHttpsProxy = process.env.HTTPS_PROXY;

  afterEach(() => {
    vi.clearAllMocks();
    if (priorHttpProxy === undefined) {
      delete process.env.HTTP_PROXY;
    } else {
      process.env.HTTP_PROXY = priorHttpProxy;
    }
    if (priorHttpsProxy === undefined) {
      delete process.env.HTTPS_PROXY;
    } else {
      process.env.HTTPS_PROXY = priorHttpsProxy;
    }
  });

  it("uses trusted SSRF policy for trusted web tools endpoints", async () => {
    vi.mocked(fetchWithSsrFGuard).mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://example.com",
      release: async () => {},
    });

    await withTrustedWebToolsEndpoint({ url: "https://example.com" }, async () => undefined);

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        policy: expect.objectContaining({
          dangerouslyAllowPrivateNetwork: true,
          allowRfc2544BenchmarkRange: true,
        }),
        mode: GUARDED_FETCH_MODE.TRUSTED_ENV_PROXY,
      }),
    );
  });

  it("keeps strict endpoint policy unchanged", async () => {
    vi.mocked(fetchWithSsrFGuard).mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://example.com",
      release: async () => {},
    });

    await withStrictWebToolsEndpoint({ url: "https://example.com" }, async () => undefined);

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
      }),
    );
    const call = vi.mocked(fetchWithSsrFGuard).mock.calls[0]?.[0];
    expect(call?.policy).toBeUndefined();
    expect(call?.mode).toBe(GUARDED_FETCH_MODE.STRICT);
  });

  it("propagates assumeProxyEnvironment when explicitly set on policy", async () => {
    vi.mocked(fetchWithSsrFGuard).mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://example.com",
      release: async () => {},
    });

    await fetchWithWebToolsNetworkGuard({
      url: "https://example.com",
      policy: { assumeProxyEnvironment: true },
    });

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ assumeProxyEnvironment: true }),
      }),
    );
  });

  it("auto-enables assumeProxyEnvironment when HTTP_PROXY is configured", async () => {
    process.env.HTTP_PROXY = "http://127.0.0.1:7890";
    delete process.env.HTTPS_PROXY;
    vi.mocked(fetchWithSsrFGuard).mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://example.com",
      release: async () => {},
    });

    await fetchWithWebToolsNetworkGuard({
      url: "https://example.com",
      policy: { allowRfc2544BenchmarkRange: true },
    });

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({
          allowRfc2544BenchmarkRange: true,
          assumeProxyEnvironment: true,
        }),
      }),
    );
  });

  it("auto-enables assumeProxyEnvironment when HTTPS_PROXY is configured", async () => {
    delete process.env.HTTP_PROXY;
    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
    vi.mocked(fetchWithSsrFGuard).mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://example.com",
      release: async () => {},
    });

    await fetchWithWebToolsNetworkGuard({
      url: "https://example.com",
    });

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ assumeProxyEnvironment: true }),
      }),
    );
  });

  it("does not enable assumeProxyEnvironment when no proxy env or explicit flag is present", async () => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    vi.mocked(fetchWithSsrFGuard).mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://example.com",
      release: async () => {},
    });

    await fetchWithWebToolsNetworkGuard({
      url: "https://example.com",
      policy: { allowRfc2544BenchmarkRange: true },
    });

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ allowRfc2544BenchmarkRange: true }),
      }),
    );
    const call = vi.mocked(fetchWithSsrFGuard).mock.calls[0]?.[0];
    expect(call?.policy).not.toHaveProperty("assumeProxyEnvironment");
  });
});
