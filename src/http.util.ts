// Small, defensive HTTP helpers shared by the middleware and interceptor.
// None of these ever throw.

/**
 * Best-effort payload size in bytes. Prefers an explicit content-length header,
 * otherwise measures the (stringified) body. Returns 0 when unknown.
 */
export function byteLength(contentLength: unknown, body: unknown): number {
  const declared = Number(Array.isArray(contentLength) ? contentLength[0] : contentLength);
  if (Number.isFinite(declared) && declared >= 0) {
    return declared;
  }
  try {
    if (body === undefined || body === null) return 0;
    if (typeof body === 'string') return Buffer.byteLength(body);
    if (Buffer.isBuffer(body)) return body.length;
    return Buffer.byteLength(JSON.stringify(body) ?? '');
  } catch {
    return 0;
  }
}

/**
 * Extract an authenticated principal id from a request, if the host app has
 * populated it (Passport/JWT commonly set req.user). Returns undefined when
 * no authenticated user is present.
 */
export function extractUserId(req: any): string | undefined {
  try {
    const user = req?.user;
    if (!user) return undefined;
    const id = user.id ?? user._id ?? user.sub ?? user.userId ?? user.uid;
    return id !== undefined && id !== null ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the real client IP from the request. Handles:
 * - x-forwarded-for header (first entry = real client behind proxy/LB)
 * - IPv4-mapped IPv6 addresses (::ffff:192.168.1.1 → 192.168.1.1)
 * - IPv6 loopback (::1)
 * - Falls back to req.ip (Express respects trust proxy)
 */
export function resolveClientIp(req: any): string {
  try {
    const forwarded = req?.headers?.['x-forwarded-for'];
    const raw: string =
      (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined)
      || req?.ip
      || req?.socket?.remoteAddress
      || '';
    return normalizeIp(raw);
  } catch {
    return req?.ip || '';
  }
}

/**
 * Normalize an IP address:
 * - Strip IPv4-mapped IPv6 prefix (::ffff:10.0.0.1 → 10.0.0.1)
 * - Trim whitespace
 */
export function normalizeIp(ip: string): string {
  if (!ip) return ip;
  const trimmed = ip.trim();
  const V4_MAPPED_PREFIX = '::ffff:';
  if (trimmed.toLowerCase().startsWith(V4_MAPPED_PREFIX)) {
    return trimmed.slice(V4_MAPPED_PREFIX.length);
  }
  return trimmed;
}
