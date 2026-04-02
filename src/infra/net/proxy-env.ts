export const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
] as const;

export function hasProxyEnvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const key of PROXY_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function normalizeProxyEnvValue(value: string | undefined): string | null | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Match undici EnvHttpProxyAgent semantics for env-based HTTP/S proxy selection:
 * - lower-case vars take precedence over upper-case
 * - HTTPS requests prefer https_proxy/HTTPS_PROXY, then fall back to http_proxy/HTTP_PROXY
 * - ALL_PROXY is ignored by EnvHttpProxyAgent
 */
export function resolveEnvHttpProxyUrl(
  protocol: "http" | "https",
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const lowerHttpProxy = normalizeProxyEnvValue(env.http_proxy);
  const lowerHttpsProxy = normalizeProxyEnvValue(env.https_proxy);
  const httpProxy =
    lowerHttpProxy !== undefined ? lowerHttpProxy : normalizeProxyEnvValue(env.HTTP_PROXY);
  const httpsProxy =
    lowerHttpsProxy !== undefined ? lowerHttpsProxy : normalizeProxyEnvValue(env.HTTPS_PROXY);
  if (protocol === "https") {
    return httpsProxy ?? httpProxy ?? undefined;
  }
  return httpProxy ?? undefined;
}

export function hasEnvHttpProxyConfigured(
  protocol: "http" | "https" = "https",
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveEnvHttpProxyUrl(protocol, env) !== undefined;
}

/**
 * Mirror undici EnvHttpProxyAgent's NO_PROXY matching so we can detect when
 * a request would bypass the proxy and connect directly.
 */
export function isHostExcludedByNoProxy(
  hostname: string,
  port?: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const noProxy = env.no_proxy ?? env.NO_PROXY ?? "";
  if (!noProxy) {
    return false;
  }
  if (noProxy.trim() === "*") {
    return true;
  }
  const normalizedHost = hostname.toLowerCase();
  for (const raw of noProxy.split(/[,\s]/)) {
    if (!raw) {
      continue;
    }
    const parsed = raw.match(/^(.+):(\d+)$/);
    const entryHost = (parsed ? parsed[1] : raw).replace(/^\*?\./, "").toLowerCase();
    const entryPort = parsed ? Number.parseInt(parsed[2], 10) : 0;
    if (entryPort && entryPort !== (port ?? 0)) {
      continue;
    }
    if (normalizedHost === entryHost) {
      return true;
    }
    if (normalizedHost.endsWith(`.${entryHost}`)) {
      return true;
    }
  }
  return false;
}
