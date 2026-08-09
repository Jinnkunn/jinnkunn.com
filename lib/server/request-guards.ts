import "server-only";

/**
 * Request guards for admin API routes.
 *
 * Each route handler that accepts a body reads it through
 * `readTextWithLimit`, which enforces the cap while the body streams in.
 * The declared `Content-Length` is only an early-out: it can be missing,
 * chunked-encoded, or an outright lie, so the real limit is applied to
 * the bytes actually received.
 *
 * The same module also carries the cross-site check used by the
 * browser-facing admin routes (`checkSameSiteRequest`), because a
 * request's trustworthiness is a property of the request, not of the
 * endpoint that happens to read it.
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

const utf8Encoder = new TextEncoder();

export function checkBodySize(
  body: string,
  maxBytes: number,
): BodyLimitOk | BodyLimitExceeded {
  // Measure encoded bytes, not UTF-16 code units: a body of multi-byte
  // characters is up to 4x larger on the wire than `.length` suggests.
  if (utf8Encoder.encode(body).byteLength > maxBytes) {
    return { ok: false, reason: "body-too-large" };
  }
  return { ok: true };
}

type BodyStreamLike = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<unknown>;
    releaseLock?(): void;
  };
};

/** Consecutive zero-byte reads tolerated before a stream is treated as abusive. */
const MAX_IDLE_READS = 1024;

function bodyStream(req: Request): BodyStreamLike | null {
  const body = (req as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const stream = body as Partial<BodyStreamLike>;
  return typeof stream.getReader === "function" ? (body as BodyStreamLike) : null;
}

/**
 * Read the request body as text while enforcing a maximum size. Returns
 * the raw text on success, or a tagged failure once either the declared
 * `Content-Length` or the bytes actually received exceed `maxBytes`.
 *
 * The stream is abandoned as soon as the cap is crossed, so an attacker
 * who under-declares (or omits) `Content-Length` still cannot make the
 * worker buffer an unbounded body.
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

  const stream = bodyStream(req);
  if (!stream) {
    // No readable stream (empty body, or a Request polyfill without one):
    // fall back to buffering, then apply the same cap.
    const body = await req.text();
    const actual = checkBodySize(body, maxBytes);
    if (!actual.ok) return actual;
    return { ok: true, body };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let idleReads = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (!value || value.byteLength === 0) {
        // A stream that keeps yielding empty chunks never trips the byte
        // cap, so bound the no-progress reads too — otherwise the loop is
        // the unbounded resource this guard exists to prevent.
        if (++idleReads > MAX_IDLE_READS) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: "body-too-large" };
        }
        continue;
      }
      idleReads = 0;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "body-too-large" };
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
  return { ok: true, body };
}

export type SameSiteCheck =
  | { ok: true }
  | { ok: false; reason: "cross-site" | "origin-mismatch" };

function requestOrigins(req: Request): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(req.url).origin);
  } catch {
    // Ignore: a malformed request URL simply contributes no origin.
  }
  // Behind a proxy the handler sees the internal URL, so trust the
  // forwarded host too — it is set by our own edge, not the client.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0]?.trim() || "https";
  if (host) {
    try {
      origins.add(new URL(`${proto}://${host.split(",")[0]?.trim()}`).origin);
    } catch {
      // Ignore an unparseable host header.
    }
  }
  return origins;
}

function originOf(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Decide whether a request was initiated by our own site.
 *
 * `Sec-Fetch-Site` is the primary signal (`none` covers user-typed URLs
 * and links opened by native apps, which is how the desktop client
 * starts its auth flow). `Origin`/`Referer` are checked when present so
 * clients that predate fetch metadata are still constrained. Requests
 * with none of these headers — CLI clients, server-to-server callers —
 * pass, because there is no browser ambient authority to abuse.
 *
 * A literal `Origin: null` is *not* treated as absent: browsers send it
 * from opaque origins (sandboxed frames, cross-origin redirects), which
 * is exactly the ambient-authority case this guard is for.
 */
export function checkSameSiteRequest(req: Request): SameSiteCheck {
  const fetchSite = String(req.headers.get("sec-fetch-site") || "").trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, reason: "cross-site" };
  }

  const origins = requestOrigins(req);
  for (const header of ["origin", "referer"] as const) {
    const raw = String(req.headers.get(header) || "").trim();
    if (!raw) continue;
    const origin = originOf(raw);
    if (!origin || !origins.has(origin)) {
      return { ok: false, reason: "origin-mismatch" };
    }
  }
  return { ok: true };
}
