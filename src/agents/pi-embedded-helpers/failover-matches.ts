type ErrorPattern = RegExp | string;

const PERIODIC_USAGE_LIMIT_RE =
  /\b(?:daily|weekly|monthly)(?:\/(?:daily|weekly|monthly))* (?:usage )?limit(?:s)?(?: (?:exhausted|reached|exceeded))?\b/i;

const ERROR_PATTERNS = {
  rateLimit: [
    /rate[_ ]limit|too many requests|429/,
    "model_cooldown",
    "exceeded your current quota",
    "resource has been exhausted",
    "quota exceeded",
    "resource_exhausted",
    "usage limit",
    /\btpm\b/i,
    "tokens per minute",
    "tokens per day",
    // Chinese provider rate-limit messages
    "请求过于频繁",
    "调用频率",
    "频率限制",
    "配额不足",
    "配额已用尽",
    "额度不足",
    "额度已用尽",
  ],
  overloaded: [
    /overloaded_error|"type"\s*:\s*"overloaded_error"/i,
    "overloaded",
    // Match "service unavailable" only when combined with an explicit overload
    // indicator — a generic 503 from a proxy/CDN should not be classified as
    // provider-overload (#32828).
    /service[_ ]unavailable.*(?:overload|capacity|high[_ ]demand)|(?:overload|capacity|high[_ ]demand).*service[_ ]unavailable/i,
    "high demand",
    // Chinese provider overloaded messages
    "服务过载",
    "当前负载过高",
  ],
  serverError: [
    "an error occurred while processing",
    "internal server error",
    "internal_error",
    "server_error",
    "service temporarily unavailable",
    "service_unavailable",
    "bad gateway",
    "gateway timeout",
    "upstream error",
    "upstream connect error",
    "connection reset",
    // Chinese provider server error messages
    "内部错误",
    "服务器错误",
    "服务器内部错误",
    "系统错误",
    "系统繁忙",
    "系统异常",
  ],
  timeout: [
    "timeout",
    "timed out",
    "service unavailable",
    "deadline exceeded",
    "context deadline exceeded",
    "connection error",
    "network error",
    "network request failed",
    "fetch failed",
    "socket hang up",
    // Chinese provider error messages (ZhipuAI/GLM, Bailian, Kimi/Moonshot, DeepSeek, etc.)
    "网络错误",
    "网络异常",
    "服务暂时不可用",
    "服务繁忙",
    "请求超时",
    "连接超时",
    "连接错误",
    /\beconn(?:refused|reset|aborted)\b/i,
    /\benetunreach\b/i,
    /\behostunreach\b/i,
    /\behostdown\b/i,
    /\benetreset\b/i,
    /\betimedout\b/i,
    /\besockettimedout\b/i,
    /\bepipe\b/i,
    /\benotfound\b/i,
    /\beai_again\b/i,
    /without sending (?:any )?chunks?/i,
    /\bstop reason:\s*(?:abort|error|malformed_response|network_error)\b/i,
    /\breason:\s*(?:abort|error|malformed_response|network_error)\b/i,
    /\bunhandled stop reason:\s*(?:abort|error|malformed_response|network_error)\b/i,
    // AbortError messages from fetch/stream aborts (Ollama NDJSON stream
    // timeouts, signal aborts, etc.) — without these the flattened message
    // falls through to reason=unknown (#58315).
    /\boperation was aborted\b/i,
    /\bstream (?:was )?(?:closed|aborted)\b/i,
  ],
  billing: [
    /["']?(?:status|code)["']?\s*[:=]\s*402\b|\bhttp\s*402\b|\berror(?:\s+code)?\s*[:=]?\s*402\b|\b(?:got|returned|received)\s+(?:a\s+)?402\b|^\s*402\s+payment/i,
    "payment required",
    "insufficient credits",
    /insufficient[_ ]quota/i,
    "credit balance",
    "plans & billing",
    "insufficient balance",
    "insufficient usd or diem balance",
    /requires?\s+more\s+credits/i,
    // Chinese provider billing messages
    "余额不足",
    "账户余额不足",
    "欠费",
    "账户已欠费",
  ],
  authPermanent: [
    /api[_ ]?key[_ ]?(?:revoked|invalid|deactivated|deleted)/i,
    "invalid_api_key",
    "key has been disabled",
    "key has been revoked",
    "account has been deactivated",
    /could not (?:authenticate|validate).*(?:api[_ ]?key|credentials)/i,
    "permission_error",
    "not allowed for this organization",
  ],
  auth: [
    /invalid[_ ]?api[_ ]?key/,
    "incorrect api key",
    "invalid token",
    "authentication",
    "re-authenticate",
    "oauth token refresh failed",
    "unauthorized",
    "forbidden",
    "access denied",
    "insufficient permissions",
    "insufficient permission",
    /missing scopes?:/i,
    "expired",
    "token has expired",
    /\b401\b/,
    /\b403\b/,
    "no credentials found",
    "no api key found",
    /\bfailed to (?:extract|parse|validate|decode)\b.*\btoken\b/,
    // Chinese provider auth messages
    "无权访问",
    "认证失败",
    "鉴权失败",
    "密钥无效",
    "apikey 无效",
  ],
  format: [
    "string should match pattern",
    "tool_use.id",
    "tool_use_id",
    "messages.1.content.1.tool_use.id",
    "invalid request format",
    /tool call id was.*must be/i,
  ],
} as const;

const BILLING_ERROR_HEAD_RE =
  /^(?:error[:\s-]+)?billing(?:\s+error)?(?:[:\s-]+|$)|^(?:error[:\s-]+)?(?:credit balance|insufficient credits?|payment required|http\s*402\b)/i;
const BILLING_ERROR_HARD_402_RE =
  /["']?(?:status|code)["']?\s*[:=]\s*402\b|\bhttp\s*402\b|\berror(?:\s+code)?\s*[:=]?\s*402\b|^\s*402\s+payment/i;
const BILLING_ERROR_MAX_LENGTH = 512;

function matchesErrorPatterns(raw: string, patterns: readonly ErrorPattern[]): boolean {
  if (!raw) {
    return false;
  }
  const value = raw.toLowerCase();
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(value) : value.includes(pattern),
  );
}

export function matchesFormatErrorPattern(raw: string): boolean {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.format);
}

export function isRateLimitErrorMessage(raw: string): boolean {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.rateLimit);
}

export function isTimeoutErrorMessage(raw: string): boolean {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.timeout);
}

export function isPeriodicUsageLimitErrorMessage(raw: string): boolean {
  return PERIODIC_USAGE_LIMIT_RE.test(raw);
}

export function isBillingErrorMessage(raw: string): boolean {
  const value = raw.toLowerCase();
  if (!value) {
    return false;
  }

  if (raw.length > BILLING_ERROR_MAX_LENGTH) {
    return BILLING_ERROR_HARD_402_RE.test(value);
  }
  if (matchesErrorPatterns(value, ERROR_PATTERNS.billing)) {
    return true;
  }
  if (!BILLING_ERROR_HEAD_RE.test(raw)) {
    return false;
  }
  return (
    value.includes("upgrade") ||
    value.includes("credits") ||
    value.includes("payment") ||
    value.includes("plan")
  );
}

export function isAuthPermanentErrorMessage(raw: string): boolean {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.authPermanent);
}

export function isAuthErrorMessage(raw: string): boolean {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.auth);
}

export function isOverloadedErrorMessage(raw: string): boolean {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.overloaded);
}

export function isServerErrorMessage(raw: string): boolean {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.serverError);
}
