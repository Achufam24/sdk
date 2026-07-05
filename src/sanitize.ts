// ---------------------------------------------------------------------------
// Redaction of sensitive data before it ever leaves the process. Applied to
// request/response bodies and to captured headers. Matching is case-insensitive
// and substring-based so variants like "userPassword", "access_token",
// "clientSecret", "x-api-key" are all caught.
// ---------------------------------------------------------------------------

export const REDACTED = '[REDACTED]';

// Substrings that mark a key as sensitive.
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'token',
  'secret',
  'apikey',
  'api-key',
  'authorization',
  'auth',
  'cookie',
  'session',
  'credential',
  'private',
  'pwd',
];

// Sensitive request/response headers redacted wholesale.
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
];

function isSensitiveKey(key: string, extraKeys: string[]): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return true;
  }
  // Caller-supplied fields (the `redact` option) match by exact name,
  // case-insensitive, to avoid over-redacting.
  return extraKeys.some((k) => k.toLowerCase() === lower);
}

/**
 * Deep-redact sensitive fields in an object/array. Returns a sanitized copy and
 * never mutates the input. Depth-limited and cycle-safe so it can't hang or
 * blow the stack on hostile payloads. Never throws.
 *
 * @param extraKeys additional field names to redact (from the `redact` option).
 */
export function sanitizeBody(body: any, extraKeys: string[] = [], maxDepth = 6): any {
  try {
    return redact(body, extraKeys, maxDepth, new WeakSet());
  } catch {
    return body;
  }
}

function redact(value: any, extraKeys: string[], depth: number, seen: WeakSet<object>): any {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth <= 0) {
    return Array.isArray(value) ? '[Array]' : '[Object]';
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, extraKeys, depth - 1, seen));
  }

  const out: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key, extraKeys)) {
      out[key] = REDACTED;
    } else {
      out[key] = redact(value[key], extraKeys, depth - 1, seen);
    }
  }
  return out;
}

/**
 * Sanitize request/response headers: drop known auth headers to [REDACTED] and
 * also catch any other header whose name looks sensitive. Never throws.
 *
 * @param extraKeys additional header names to redact (from the `redact` option).
 */
export function sanitizeHeaders(
  headers: Record<string, any> = {},
  extraKeys: string[] = [],
): Record<string, any> {
  try {
    const out: Record<string, any> = {};
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADERS.includes(lower) || isSensitiveKey(key, extraKeys)) {
        out[key] = REDACTED;
      } else {
        out[key] = headers[key];
      }
    }
    return out;
  } catch {
    return {};
  }
}
