import "server-only";

/**
 * Request guards for admin API routes.
 *
 * Each route handler that accepts a body calls `enforceMaxBodySize` to
 * reject oversized inputs before they consume memory. The guard checks
 * the `Content-Length` header if present; callers must also check the
 * size of the already-read body (because `Content-Length` can be
 * missing, chunked-encoded, or lied about).
 */

export type BodyLimitExceeded = { ok: false; reason: "body-too-large" };
export type BodyLimitOk = { ok: true };

export function checkDeclaredContentLength(
  req: Request,
  maxBytes: number,
): BodyLimitOk | BodyLimitExceeded {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "body-too-large" };
  }
  return { ok: true };
}

export function checkBodySize(
  body: string,
  maxBytes: number,
): BodyLimitOk | BodyLimitExceeded {
  if (body.length > maxBytes) return { ok: false, reason: "body-too-large" };
  return { ok: true };
}

/**
 * Read `req.text()` while enforcing a maximum size. Returns the raw
 * text on success, or a tagged failure if either the declared
 * `Content-Length` or the actual read size exceeded `maxBytes`.
 */
export async function readTextWithLimit(
  req: Request,
  maxBytes: number,
): Promise<
  | { ok: true; body: string }
  | BodyLimitExceeded
> {
  const declared = checkDeclaredContentLength(req, maxBytes);
  if (!declared.ok) return declared;

  const body = await req.text();
  const actual = checkBodySize(body, maxBytes);
  if (!actual.ok) return actual;
  return { ok: true, body };
}
