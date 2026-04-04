import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  collectAttackSurfaceSummaryFindings,
  collectExposureMatrixFindings,
  collectLikelyMultiUserSetupFindings,
  collectSmallModelRiskFindings,
} from "./audit-extra.sync.js";
import { safeEqualSecret } from "./secret-equal.js";

describe("collectAttackSurfaceSummaryFindings", () => {
  it.each([
    {
      name: "distinguishes external webhooks from internal hooks when only internal hooks are enabled",
      cfg: {
        hooks: { internal: { enabled: true } },
      } satisfies OpenClawConfig,
      expectedDetail: ["hooks.webhooks: disabled", "hooks.internal: enabled"],
    },
    {
      name: "reports both hook systems as enabled when both are configured",
      cfg: {
        hooks: { enabled: true, internal: { enabled: true } },
      } satisfies OpenClawConfig,
      expectedDetail: ["hooks.webhooks: enabled", "hooks.internal: enabled"],
    },
    {
      name: "reports internal hooks as enabled by default and webhooks as disabled when neither is configured",
      cfg: {} satisfies OpenClawConfig,
      expectedDetail: ["hooks.webhooks: disabled", "hooks.internal: enabled"],
    },
    {
      name: "reports internal hooks as disabled when explicitly set to false",
      cfg: {
        hooks: { internal: { enabled: false } },
      } satisfies OpenClawConfig,
      expectedDetail: ["hooks.internal: disabled"],
    },
  ])("$name", ({ cfg, expectedDetail }) => {
    const [finding] = collectAttackSurfaceSummaryFindings(cfg);
    expect(finding.checkId).toBe("summary.attack_surface");
    for (const snippet of expectedDetail) {
      expect(finding.detail).toContain(snippet);
    }
  });
});

describe("safeEqualSecret", () => {
  it.each([
    ["secret-token", "secret-token", true],
    ["secret-token", "secret-tokEn", false],
    ["short", "much-longer", false],
    [undefined, "secret", false],
    ["secret", undefined, false],
    [null, "secret", false],
  ] as const)("compares %o and %o", (left, right, expected) => {
    expect(safeEqualSecret(left, right)).toBe(expected);
  });
});

describe("collectSmallModelRiskFindings", () => {
  const browserOffCfg = {
    agents: { defaults: { model: { primary: "ollama/mistral-8b" } } },
    browser: { enabled: false },
    tools: { web: { fetch: { enabled: false } } },
  } satisfies OpenClawConfig;
  const browserDefaultCfg = {
    agents: { defaults: { model: { primary: "ollama/mistral-8b" } } },
    tools: { web: { fetch: { enabled: false } } },
  } satisfies OpenClawConfig;

  it.each([
    {
      name: "small model without sandbox all stays critical even when browser/web tools are off",
      cfg: browserOffCfg,
      env: {},
      detailIncludes: ["web=[off]", "No web/browser tools detected"],
      detailExcludes: ["web=[browser]"],
    },
    {
      name: "treats browser as enabled by default when browser config is omitted",
      cfg: browserDefaultCfg,
      env: {},
      detailIncludes: ["web=[browser]"],
      detailExcludes: ["No web/browser tools detected"],
    },
  ])("$name", ({ cfg, env, detailIncludes, detailExcludes }) => {
    const [finding] = collectSmallModelRiskFindings({
      cfg,
      env,
    });

    expect(finding?.checkId).toBe("models.small_params");
    expect(finding?.severity).toBe("critical");
    expect(finding?.detail).toContain("ollama/mistral-8b");
    for (const snippet of detailIncludes) {
      expect(finding?.detail).toContain(snippet);
    }
    for (const snippet of detailExcludes) {
      expect(finding?.detail).not.toContain(snippet);
    }
  });
});

describe("collectExposureMatrixFindings - dmPolicy parity (#55612)", () => {
  it("flags dmPolicy='open' with elevated tools enabled", () => {
    const cfg: OpenClawConfig = {
      tools: { elevated: { enabled: true, allowFrom: { whatsapp: ["+1"] } } },
      channels: { whatsapp: { dmPolicy: "open" } },
    };
    const findings = collectExposureMatrixFindings(cfg);
    const ids = findings.map((f) => f.checkId);
    expect(ids).toContain("security.exposure.open_dms_with_elevated");
    expect(
      findings.find((f) => f.checkId === "security.exposure.open_dms_with_elevated")?.severity,
    ).toBe("critical");
  });

  it("flags dmPolicy='open' with runtime/fs tools exposed", () => {
    const cfg: OpenClawConfig = {
      channels: { whatsapp: { dmPolicy: "open" } },
      tools: { elevated: { enabled: false } },
    };
    const findings = collectExposureMatrixFindings(cfg);
    const ids = findings.map((f) => f.checkId);
    expect(ids).toContain("security.exposure.open_dms_with_runtime_or_fs");
  });

  it("does not flag dmPolicy runtime/fs when sandbox=all", () => {
    const cfg: OpenClawConfig = {
      channels: { whatsapp: { dmPolicy: "open" } },
      tools: { elevated: { enabled: false }, profile: "coding" },
      agents: { defaults: { sandbox: { mode: "all" } } },
    };
    const findings = collectExposureMatrixFindings(cfg);
    expect(
      findings.some((f) => f.checkId === "security.exposure.open_dms_with_runtime_or_fs"),
    ).toBe(false);
  });

  it("emits both group and dm findings when both policies are open", () => {
    const cfg: OpenClawConfig = {
      tools: { elevated: { enabled: true, allowFrom: { whatsapp: ["+1"] } } },
      channels: { whatsapp: { groupPolicy: "open", dmPolicy: "open" } },
    };
    const findings = collectExposureMatrixFindings(cfg);
    const ids = findings.map((f) => f.checkId);
    expect(ids).toContain("security.exposure.open_groups_with_elevated");
    expect(ids).toContain("security.exposure.open_dms_with_elevated");
  });

  it("preserves existing groupPolicy='open' behavior unchanged", () => {
    const cfg: OpenClawConfig = {
      tools: { elevated: { enabled: true, allowFrom: { whatsapp: ["+1"] } } },
      channels: { whatsapp: { groupPolicy: "open" } },
    };
    const findings = collectExposureMatrixFindings(cfg);
    expect(findings.some((f) => f.checkId === "security.exposure.open_groups_with_elevated")).toBe(
      true,
    );
    expect(findings.some((f) => f.checkId === "security.exposure.open_dms_with_elevated")).toBe(
      false,
    );
  });

  it("returns empty when no open policies exist", () => {
    const cfg: OpenClawConfig = {
      channels: { whatsapp: { groupPolicy: "allowlist", dmPolicy: "pairing" } },
    };
    const findings = collectExposureMatrixFindings(cfg);
    expect(findings.length).toBe(0);
  });

  it("detects account-level dmPolicy='open'", () => {
    const cfg: OpenClawConfig = {
      tools: { elevated: { enabled: true, allowFrom: { whatsapp: ["+1"] } } },
      channels: { whatsapp: { accounts: { myAccount: { dmPolicy: "open" } } } },
    };
    const findings = collectExposureMatrixFindings(cfg);
    const dm = findings.find((f) => f.checkId === "security.exposure.open_dms_with_elevated");
    expect(dm).toBeDefined();
    expect(dm?.detail).toContain("channels.whatsapp.accounts.myAccount.dmPolicy");
  });
});

describe("collectLikelyMultiUserSetupFindings - dmScope check (#55578)", () => {
  it("flags dmScope='main' when multi-user signals exist", () => {
    const cfg: OpenClawConfig = {
      session: { dmScope: "main" },
      channels: { whatsapp: { dmPolicy: "open" } },
    };
    const findings = collectLikelyMultiUserSetupFindings(cfg);
    const dmScopeFinding = findings.find(
      (f) => f.checkId === "security.trust_model.dm_scope_main_multi_user",
    );
    expect(dmScopeFinding).toBeDefined();
    expect(dmScopeFinding?.severity).toBe("critical");
    expect(dmScopeFinding?.detail).toContain("session.dmScope");
    expect(dmScopeFinding?.remediation).toContain("per-channel-peer");
  });

  it("flags default dmScope (unset) when multi-user signals exist", () => {
    const cfg: OpenClawConfig = {
      channels: { whatsapp: { dmPolicy: "open" } },
    };
    const findings = collectLikelyMultiUserSetupFindings(cfg);
    expect(
      findings.some((f) => f.checkId === "security.trust_model.dm_scope_main_multi_user"),
    ).toBe(true);
  });

  it("does not flag when dmScope is per-channel-peer", () => {
    const cfg: OpenClawConfig = {
      session: { dmScope: "per-channel-peer" },
      channels: { whatsapp: { dmPolicy: "open" } },
    };
    const findings = collectLikelyMultiUserSetupFindings(cfg);
    expect(
      findings.some((f) => f.checkId === "security.trust_model.dm_scope_main_multi_user"),
    ).toBe(false);
  });

  it("does not flag dmScope when no multi-user signals", () => {
    const cfg: OpenClawConfig = {
      session: { dmScope: "main" },
      channels: { whatsapp: {} },
    };
    const findings = collectLikelyMultiUserSetupFindings(cfg);
    expect(
      findings.some((f) => f.checkId === "security.trust_model.dm_scope_main_multi_user"),
    ).toBe(false);
  });

  it("still emits multi_user_heuristic alongside dmScope finding", () => {
    const cfg: OpenClawConfig = {
      session: { dmScope: "main" },
      channels: { whatsapp: { dmPolicy: "open" } },
    };
    const findings = collectLikelyMultiUserSetupFindings(cfg);
    expect(findings.some((f) => f.checkId === "security.trust_model.multi_user_heuristic")).toBe(
      true,
    );
    expect(
      findings.some((f) => f.checkId === "security.trust_model.dm_scope_main_multi_user"),
    ).toBe(true);
  });
});
