import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBotFrameworkJwtValidator,
  createMSTeamsAdapter,
  createMSTeamsApp,
  type MSTeamsTeamsSdk,
} from "./sdk.js";
import type {
  MSTeamsCredentials,
  MSTeamsSecretCredentials,
  MSTeamsFederatedCredentials,
} from "./token.js";

const jwtValidatorState = vi.hoisted(() => ({
  instances: [] as Array<{ config: Record<string, unknown> }>,
  behaviorByJwks: new Map<string, "success" | "null" | "throw">(),
  calls: [] as Array<{ jwksUri: string; token: string; overrideOptions?: unknown }>,
}));

const clientConstructorState = vi.hoisted(() => ({
  calls: [] as Array<{ serviceUrl: string; options: unknown }>,
}));

vi.mock("@microsoft/teams.apps/dist/middleware/auth/jwt-validator.js", () => ({
  JwtValidator: class JwtValidator {
    private readonly config: Record<string, unknown>;

    constructor(config: Record<string, unknown>) {
      this.config = config;
      jwtValidatorState.instances.push({ config });
    }

    async validateAccessToken(token: string, overrideOptions?: unknown): Promise<object | null> {
      const jwksUri = String((this.config.jwksUriOptions as { uri?: string })?.uri ?? "");
      jwtValidatorState.calls.push({ jwksUri, token, overrideOptions });
      const behavior = jwtValidatorState.behaviorByJwks.get(jwksUri) ?? "null";
      if (behavior === "throw") {
        throw new Error("validator error");
      }
      return behavior === "success" ? { sub: "ok" } : null;
    }
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(
    () => "-----BEGIN RSA PRIVATE KEY-----\nfake-key\n-----END RSA PRIVATE KEY-----",
  ),
}));

const { mockGetToken } = vi.hoisted(() => {
  const mockGetToken = vi.fn().mockResolvedValue({ token: "mock-managed-token" });
  return { mockGetToken };
});
vi.mock("@azure/identity", () => {
  // Use classes so `new ...Credential()` works after vitest hoisting
  // (function declarations inside vi.mock factories can be transformed
  // into arrow functions during hoisting, which breaks `new`).
  class ManagedIdentityCredential {
    getToken = mockGetToken;
  }
  class DefaultAzureCredential {
    getToken = mockGetToken;
  }
  class ClientCertificateCredential {
    getToken = mockGetToken;
  }
  return { ManagedIdentityCredential, DefaultAzureCredential, ClientCertificateCredential };
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clientConstructorState.calls.length = 0;
  jwtValidatorState.instances.length = 0;
  jwtValidatorState.calls.length = 0;
  jwtValidatorState.behaviorByJwks.clear();
  vi.restoreAllMocks();
});

function createSdkStub(): MSTeamsTeamsSdk {
  class AppStub {
    async getBotToken() {
      return {
        toString() {
          return "bot-token";
        },
      };
    }
  }

  class ClientStub {
    constructor(serviceUrl: string, options: unknown) {
      clientConstructorState.calls.push({ serviceUrl, options });
    }

    conversations = {
      activities: (_conversationId: string) => ({
        create: async (_activity: unknown) => ({ id: "created" }),
      }),
    };
  }

  return {
    App: AppStub as unknown as MSTeamsTeamsSdk["App"],
    Client: ClientStub as unknown as MSTeamsTeamsSdk["Client"],
  };
}

describe("createMSTeamsApp", () => {
  it("does not crash with express 5 path-to-regexp (#55161)", async () => {
    // Regression test for: https://github.com/openclaw/openclaw/issues/55161
    // createMSTeamsApp passes a no-op httpServerAdapter to prevent the SDK from
    // creating its default HttpPlugin (which registers `/api*` — invalid in Express 5).
    const { App } = await import("@microsoft/teams.apps");
    const { Client } = await import("@microsoft/teams.api");
    const sdk: MSTeamsTeamsSdk = { App, Client };
    const creds: MSTeamsCredentials = {
      type: "secret",
      appId: "test-app-id",
      appPassword: "test-secret",
      tenantId: "test-tenant",
    };

    // This would throw "Missing parameter name at index 5: /api*" without the fix
    const app = await createMSTeamsApp(creds, sdk);
    expect(app).toBeDefined();
    // Verify token methods are available (the reason we use the App class)
    expect(typeof (app as unknown as Record<string, unknown>).getBotToken).toBe("function");
  });
});

describe("createMSTeamsAdapter", () => {
  it("provides deleteActivity in proactive continueConversation contexts", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const creds = {
      appId: "app-id",
      type: "secret",
      appPassword: "secret",
      tenantId: "tenant-id",
    } satisfies MSTeamsCredentials;
    const sdk = createSdkStub();
    const app = new sdk.App({
      clientId: creds.appId,
      clientSecret: creds.appPassword,
      tenantId: creds.tenantId,
    });
    const adapter = createMSTeamsAdapter(app, sdk);

    await adapter.continueConversation(
      creds.appId,
      {
        serviceUrl: "https://service.example.com/",
        conversation: { id: "19:conversation@thread.tacv2" },
        channelId: "msteams",
      },
      async (ctx) => {
        await ctx.deleteActivity("activity-123");
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://service.example.com/v3/conversations/19%3Aconversation%40thread.tacv2/activities/activity-123",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer bot-token",
        }),
      }),
    );
  });

  it("passes the OpenClaw User-Agent to the Bot Framework connector client", async () => {
    const creds = {
      appId: "app-id",
      appPassword: "secret",
      tenantId: "tenant-id",
    } satisfies MSTeamsCredentials;
    const sdk = createSdkStub();
    const app = new sdk.App({
      clientId: creds.appId,
      clientSecret: creds.appPassword,
      tenantId: creds.tenantId,
    });
    const adapter = createMSTeamsAdapter(app, sdk);

    await adapter.continueConversation(
      creds.appId,
      {
        serviceUrl: "https://service.example.com/",
        conversation: { id: "19:conversation@thread.tacv2" },
        channelId: "msteams",
      },
      async (ctx) => {
        await ctx.sendActivity("hello");
      },
    );

    expect(clientConstructorState.calls).toHaveLength(1);
    expect(clientConstructorState.calls[0]).toMatchObject({
      serviceUrl: "https://service.example.com/",
      options: {
        headers: {
          "User-Agent": expect.stringMatching(/^teams\.ts\[apps\]\/.+ OpenClaw\/.+$/),
        },
      },
    });
  });
});

describe("createBotFrameworkJwtValidator", () => {
  const creds = {
    appId: "app-id",
    type: "secret",
    appPassword: "secret",
    tenantId: "tenant-id",
  } satisfies MSTeamsCredentials;

  it("validates with legacy Bot Framework JWKS and issuer first", async () => {
    jwtValidatorState.behaviorByJwks.set(
      "https://login.botframework.com/v1/.well-known/keys",
      "success",
    );

    const validator = await createBotFrameworkJwtValidator(creds);
    await expect(validator.validate("Bearer token-1", "https://service.example.com")).resolves.toBe(
      true,
    );

    expect(jwtValidatorState.instances).toHaveLength(2);
    expect(jwtValidatorState.calls).toHaveLength(1);
    expect(jwtValidatorState.calls[0]).toMatchObject({
      jwksUri: "https://login.botframework.com/v1/.well-known/keys",
      token: "token-1",
      overrideOptions: {
        validateServiceUrl: { expectedServiceUrl: "https://service.example.com" },
      },
    });
  });

  it("falls back to Entra JWKS when Bot Framework validation fails", async () => {
    jwtValidatorState.behaviorByJwks.set(
      "https://login.botframework.com/v1/.well-known/keys",
      "null",
    );
    jwtValidatorState.behaviorByJwks.set(
      "https://login.microsoftonline.com/common/discovery/v2.0/keys",
      "success",
    );

    const validator = await createBotFrameworkJwtValidator(creds);
    await expect(validator.validate("Bearer token-2")).resolves.toBe(true);

    expect(jwtValidatorState.calls).toHaveLength(2);
    expect(jwtValidatorState.calls[0]?.jwksUri).toBe(
      "https://login.botframework.com/v1/.well-known/keys",
    );
    expect(jwtValidatorState.calls[1]?.jwksUri).toBe(
      "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    );

    const entraConfig = jwtValidatorState.instances
      .map((instance) => instance.config)
      .find(
        (config) =>
          String((config.jwksUriOptions as { uri?: string })?.uri) ===
          "https://login.microsoftonline.com/common/discovery/v2.0/keys",
      );
    expect(entraConfig).toBeDefined();
    expect(entraConfig?.validateIssuer).toEqual({ allowedTenantIds: ["tenant-id"] });
  });

  it("falls back to Entra JWKS when Bot Framework validation throws", async () => {
    jwtValidatorState.behaviorByJwks.set(
      "https://login.botframework.com/v1/.well-known/keys",
      "throw",
    );
    jwtValidatorState.behaviorByJwks.set(
      "https://login.microsoftonline.com/common/discovery/v2.0/keys",
      "success",
    );

    const validator = await createBotFrameworkJwtValidator(creds);
    await expect(
      validator.validate("Bearer token-throw", "https://service.example.com"),
    ).resolves.toBe(true);

    expect(jwtValidatorState.calls).toHaveLength(2);
    expect(jwtValidatorState.calls[0]).toMatchObject({
      jwksUri: "https://login.botframework.com/v1/.well-known/keys",
      token: "token-throw",
      overrideOptions: {
        validateServiceUrl: { expectedServiceUrl: "https://service.example.com" },
      },
    });
    expect(jwtValidatorState.calls[1]).toMatchObject({
      jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
      token: "token-throw",
      overrideOptions: {
        validateServiceUrl: { expectedServiceUrl: "https://service.example.com" },
      },
    });
  });

  it("returns false when all validator paths fail", async () => {
    jwtValidatorState.behaviorByJwks.set(
      "https://login.botframework.com/v1/.well-known/keys",
      "throw",
    );

    const validator = await createBotFrameworkJwtValidator(creds);
    await expect(validator.validate("Bearer token-3")).resolves.toBe(false);
    expect(jwtValidatorState.calls).toHaveLength(2);
  });

  it("returns false for empty bearer token", async () => {
    const validator = await createBotFrameworkJwtValidator(creds);
    await expect(validator.validate("Bearer ")).resolves.toBe(false);
    expect(jwtValidatorState.calls).toHaveLength(0);
  });
});

function makeFakeSdk() {
  const appInstances: Record<string, unknown>[] = [];
  const FakeApp = class {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      appInstances.push(opts);
    }
  };
  return { sdk: { App: FakeApp as any, Client: class {} as any }, appInstances, FakeApp };
}

describe("createMSTeamsApp – secret credentials", () => {
  it("passes clientId, clientSecret, tenantId to sdk.App", async () => {
    const { sdk, appInstances } = makeFakeSdk();
    const creds: MSTeamsSecretCredentials = {
      type: "secret",
      appId: "my-app-id",
      appPassword: "my-secret",
      tenantId: "my-tenant",
    };
    const app = await createMSTeamsApp(creds, sdk);
    expect(app).toBeDefined();
    expect(appInstances[0]).toMatchObject({
      clientId: "my-app-id",
      clientSecret: "my-secret",
      tenantId: "my-tenant",
    });
  });
});

describe("createMSTeamsApp – federated certificate credentials", () => {
  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      "-----BEGIN RSA PRIVATE KEY-----\nfake-key\n-----END RSA PRIVATE KEY-----",
    );
  });

  it("reads the certificate and creates app with token function", async () => {
    const { sdk, appInstances } = makeFakeSdk();
    const creds: MSTeamsFederatedCredentials = {
      type: "federated",
      appId: "fed-app-id",
      tenantId: "fed-tenant",
      certificatePath: "/certs/bot.pem",
      certificateThumbprint: "AABB1122",
    };
    await createMSTeamsApp(creds, sdk);
    expect(fs.readFileSync).toHaveBeenCalledWith("/certs/bot.pem", "utf-8");
    expect(appInstances[0]).toMatchObject({
      clientId: "fed-app-id",
      tenantId: "fed-tenant",
    });
    expect(typeof appInstances[0].token).toBe("function");
    const token = await (appInstances[0].token as (scope: string) => Promise<string>)(
      "https://api.botframework.com/.default",
    );
    expect(token).toBe("mock-managed-token");
  });

  it("wraps readFileSync errors with descriptive message", async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    const { sdk } = makeFakeSdk();
    const creds: MSTeamsFederatedCredentials = {
      type: "federated",
      appId: "fed-app-id",
      tenantId: "fed-tenant",
      certificatePath: "/missing/cert.pem",
    };
    await expect(async () => await createMSTeamsApp(creds, sdk)).rejects.toThrow(
      /Failed to read certificate file at '\/missing\/cert\.pem'/,
    );
  });

  it("throws when federated but no certificatePath and no managedIdentity", async () => {
    const { sdk } = makeFakeSdk();
    const creds: MSTeamsFederatedCredentials = {
      type: "federated",
      appId: "fed-app-id",
      tenantId: "fed-tenant",
    };
    await expect(async () => await createMSTeamsApp(creds, sdk)).rejects.toThrow(
      /certificate path or managed identity/i,
    );
  });
});

describe("createMSTeamsApp – federated managed identity", () => {
  it("creates app with token function for user-assigned MI", async () => {
    const { sdk, appInstances } = makeFakeSdk();
    const creds: MSTeamsFederatedCredentials = {
      type: "federated",
      appId: "mi-app-id",
      tenantId: "mi-tenant",
      useManagedIdentity: true,
      managedIdentityClientId: "mi-client-id",
    };
    await createMSTeamsApp(creds, sdk);
    expect(appInstances[0]).toMatchObject({ clientId: "mi-app-id", tenantId: "mi-tenant" });
    expect(typeof appInstances[0].token).toBe("function");
    const token = await (appInstances[0].token as (scope: string) => Promise<string>)(
      "https://api.botframework.com/.default",
    );
    expect(token).toBe("mock-managed-token");
  });

  it("creates app with token function for system-assigned MI", async () => {
    const { sdk, appInstances } = makeFakeSdk();
    const creds: MSTeamsFederatedCredentials = {
      type: "federated",
      appId: "mi-app-id",
      tenantId: "mi-tenant",
      useManagedIdentity: true,
    };
    await createMSTeamsApp(creds, sdk);
    expect(typeof appInstances[0].token).toBe("function");
    const token = await (appInstances[0].token as (scope: string) => Promise<string>)(
      "https://api.botframework.com/.default",
    );
    expect(token).toBe("mock-managed-token");
  });

  it("throws from token function when token acquisition fails", async () => {
    mockGetToken.mockResolvedValueOnce(null);
    const { sdk, appInstances } = makeFakeSdk();
    const creds: MSTeamsFederatedCredentials = {
      type: "federated",
      appId: "mi-app-id",
      tenantId: "mi-tenant",
      useManagedIdentity: true,
    };
    await createMSTeamsApp(creds, sdk);
    const tokenFn = appInstances[0].token as (scope: string) => Promise<string>;
    await expect(tokenFn("https://api.botframework.com/.default")).rejects.toThrow(
      /failed to acquire token/i,
    );
  });
});

// ── createMSTeamsAdapter tests ─────────────────────────────────────────────

function makeFakeApp() {
  return {
    getBotToken: vi.fn().mockResolvedValue({ toString: () => "fake-bot-token" }),
  } as any;
}

function makeFakeApiSdk() {
  const createFn = vi.fn().mockResolvedValue({ id: "new-activity-id" });
  const FakeClient = class {
    conversations = {
      activities: (_convId: string) => ({ create: createFn }),
    };
  };
  return {
    sdk: { App: class {} as any, Client: FakeClient as any },
    createFn,
  };
}

describe("createMSTeamsAdapter – continueConversation", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("provides sendActivity via REST API client in logic callback", async () => {
    const { sdk, createFn } = makeFakeApiSdk();
    const adapter = createMSTeamsAdapter(makeFakeApp(), sdk);

    const reference = {
      serviceUrl: "https://smba.trafficmanager.net/teams/",
      conversation: { id: "conv-123", conversationType: "personal" },
      channelId: "msteams",
    };

    await adapter.continueConversation("app-id", reference, async (ctx) => {
      await ctx.sendActivity("hello from proactive send");
    });

    expect(createFn).toHaveBeenCalledTimes(1);
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ type: "message", text: "hello from proactive send" }),
    );
  });

  it("provides deleteActivity via REST DELETE in logic callback", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;
    const { sdk } = makeFakeApiSdk();
    const adapter = createMSTeamsAdapter(makeFakeApp(), sdk);

    const reference = {
      serviceUrl: "https://smba.trafficmanager.net/teams/",
      conversation: { id: "conv-456", conversationType: "personal" },
      channelId: "msteams",
    };

    await adapter.continueConversation("app-id", reference, async (ctx) => {
      await ctx.deleteActivity("activity-789");
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/v3/conversations/conv-456/activities/activity-789");
    expect(opts.method).toBe("DELETE");
    expect(opts.headers.Authorization).toBe("Bearer fake-bot-token");
  });

  it("throws when serviceUrl is missing", async () => {
    const { sdk } = makeFakeApiSdk();
    const adapter = createMSTeamsAdapter(makeFakeApp(), sdk);

    await expect(
      adapter.continueConversation("app-id", { conversation: { id: "c" } } as any, async () => {}),
    ).rejects.toThrow(/Missing serviceUrl/);
  });

  it("throws when conversation.id is missing", async () => {
    const { sdk } = makeFakeApiSdk();
    const adapter = createMSTeamsAdapter(makeFakeApp(), sdk);

    await expect(
      adapter.continueConversation(
        "app-id",
        { serviceUrl: "https://example.com" } as any,
        async () => {},
      ),
    ).rejects.toThrow(/Missing conversation\.id/);
  });
});

describe("createMSTeamsAdapter – process", () => {
  it("sends 200 for normal message activities", async () => {
    const { sdk } = makeFakeApiSdk();
    const adapter = createMSTeamsAdapter(makeFakeApp(), sdk);

    const req = { body: { type: "message", text: "hi" } };
    const sendFn = vi.fn();
    const res = { status: vi.fn(() => ({ send: sendFn })) };

    await adapter.process(req, res, async () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendFn).toHaveBeenCalled();
  });

  it("sends 200 immediately for invoke activities", async () => {
    const { sdk } = makeFakeApiSdk();
    const adapter = createMSTeamsAdapter(makeFakeApp(), sdk);

    const req = { body: { type: "invoke", name: "adaptiveCard/action" } };
    const sendFn = vi.fn();
    const res = { status: vi.fn(() => ({ send: sendFn })) };

    let statusCalledBeforeLogic = false;
    await adapter.process(req, res, async () => {
      statusCalledBeforeLogic = res.status.mock.calls.length > 0;
    });

    expect(statusCalledBeforeLogic).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
