// Capability cookie for password-protected public routes.
//
// SECURITY: the cookie a browser presents for a protected route is NOT the
// stored password verifier. It is an HMAC keyed by a server-only secret over
// the route id. This means:
//   - reading the repo (or the baked content bundle) does NOT reveal a value
//     that can be replayed as a cookie — the secret never ships in content;
//   - the stored verifier (a salted KDF hash, see
//     `lib/server/protected-route-password.ts`) can no longer be replayed as a
//     cookie even if it leaks.
//
// This module is intentionally dependency-free and uses Web Crypto only, so it
// runs identically in Edge middleware, the Node API route, and (mirrored in
// `cloudflare/protected-route-cookie.mjs`) the Cloudflare Worker entry. Keep
// the construction byte-for-byte in sync with that `.mjs` copy.

const COOKIE_MESSAGE_PREFIX = "v1:site-auth:";

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Deterministic cookie value proving the holder unlocked `routeId`.
 * Returns "" when no secret is configured so callers fail closed (an empty
 * expectation must never satisfy a real cookie — see `timingSafeEqualHex`).
 */
export async function computeProtectedRouteCookie(
  routeId: string,
  secret: string,
): Promise<string> {
  const id = String(routeId || "").trim();
  const key = String(secret || "");
  if (!id || !key) return "";
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "";
  const encoder = new TextEncoder();
  const cryptoKey = await subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(`${COOKIE_MESSAGE_PREFIX}${id}`),
  );
  return toHex(signature);
}

/**
 * Constant-time comparison of two hex strings. Returns false for empty inputs
 * so a missing/unconfigured expectation can never match a presented cookie.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
