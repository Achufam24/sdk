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
