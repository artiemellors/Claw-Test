import { getShellEnvAppliedKeys } from "../infra/shell-env.js";
import { hasAnthropicVertexAvailableAuth } from "../plugin-sdk/anthropic-vertex-auth-presence.js";
import { normalizeOptionalSecretInput } from "../utils/normalize-secret-input.js";
import { PROVIDER_ENV_API_KEY_CANDIDATES } from "./model-auth-env-vars.js";
import {
  GCP_VERTEX_CREDENTIALS_MARKER,
  GCP_VERTEX_GOOGLE_CREDENTIALS_MARKER,
} from "./model-auth-markers.js";
import { normalizeProviderIdForAuth } from "./provider-id.js";

export type EnvApiKeyResult = {
  apiKey: string;
  source: string;
};

export function resolveEnvApiKey(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvApiKeyResult | null {
  const normalized = normalizeProviderIdForAuth(provider);
  const applied = new Set(getShellEnvAppliedKeys());
  const pick = (envVar: string): EnvApiKeyResult | null => {
    const value = normalizeOptionalSecretInput(env[envVar]);
    if (!value) {
      return null;
    }
    const source = applied.has(envVar) ? `shell env: ${envVar}` : `env: ${envVar}`;
    return { apiKey: value, source };
  };

  const candidates = PROVIDER_ENV_API_KEY_CANDIDATES[normalized];
  if (candidates) {
    for (const envVar of candidates) {
      const resolved = pick(envVar);
      if (resolved) {
        return resolved;
      }
    }
  }

  if (normalized === "google-vertex") {
    // Google Vertex AI uses GCP credentials (ADC), not API keys.
    // Return a sentinel so the model resolver treats this provider as available.
    // The actual token exchange happens at request time via the provider's wrapStreamFn.
    if (hasAnthropicVertexAvailableAuth(env)) {
      return { apiKey: GCP_VERTEX_GOOGLE_CREDENTIALS_MARKER, source: "gcloud adc" };
    }
    return null;
  }

  if (normalized === "anthropic-vertex") {
    // Vertex AI uses GCP credentials (SA JSON or ADC), not API keys.
    // Return a sentinel so the model resolver still treats this provider as available.
    if (hasAnthropicVertexAvailableAuth(env)) {
      return { apiKey: GCP_VERTEX_CREDENTIALS_MARKER, source: "gcloud adc" };
    }
    return null;
  }

  return null;
}
