// Worker-side mirror of `lib/shared/protected-route-cookie.ts`.
//
// The Cloudflare Worker entry is plain `.mjs` bundled outside the Next/TS
// build, so it cannot import the TS module. Keep the HMAC construction
// (algorithm, message prefix, hex encoding) byte-for-byte identical to the TS
// copy — middleware, the auth route, and the Worker MUST agree on the cookie
// value or a freshly issued cookie won't validate on the static-shell path.

const COOKIE_MESSAGE_PREFIX = "v1:site-auth:";

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export async function computeProtectedRouteCookie(routeId, secret) {
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

export function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
