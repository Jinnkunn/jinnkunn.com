import crypto from "node:crypto";

// Password verifier storage for protected routes.
//
// SECURITY: passwords are stored as scrypt(password, per-route-random-salt),
// NOT sha256(public-path + password). The old scheme used the route path/pageId
// (a public, guessable value) as the only "salt" and a single SHA-256 pass, so
// a leaked verifier was trivially brute-forceable. scrypt is a memory-hard KDF
// and the random salt defeats precomputation.
//
// Verifiers are self-describing: `scrypt$v1$<saltHex>$<hashHex>`. A legacy
// `<64-hex>` value is still accepted (verified against the old construction)
// so routes provisioned before this change keep working until their password
// is re-set, at which point they upgrade to scrypt automatically.

const SCRYPT_PREFIX = "scrypt$v1$";
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LEN = 32;
const SALT_BYTES = 16;
// scrypt with N=16384 needs ~16MB; raise maxmem above the 32MB default headroom
// so it never throws on memory accounting across runtimes.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function scryptHash(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function timingSafeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** Produce a fresh scrypt verifier for `password`. */
export function hashProtectedRoutePassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = scryptHash(String(password), salt);
  return `${SCRYPT_PREFIX}${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function isScryptVerifier(stored: string): boolean {
  return typeof stored === "string" && stored.startsWith(SCRYPT_PREFIX);
}

/**
 * Verify `password` against a stored verifier.
 *
 * - scrypt verifiers (`scrypt$v1$…`) are checked with a constant-time compare.
 * - Legacy verifiers (raw 64-char sha256 hex) are checked against
 *   sha256(`${legacySalt}\n${password}`), matching the historical construction
 *   in `app/api/site-auth/route.ts`. Pass the route's pageId/path as
 *   `legacySalt` for those.
 */
export function verifyProtectedRoutePassword(
  password: string,
  stored: string,
  legacySalt: string,
): boolean {
  const verifier = String(stored || "");
  if (!verifier) return false;

  if (isScryptVerifier(verifier)) {
    const rest = verifier.slice(SCRYPT_PREFIX.length);
    const sep = rest.indexOf("$");
    if (sep <= 0) return false;
    const saltHex = rest.slice(0, sep);
    const hashHex = rest.slice(sep + 1);
    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(saltHex, "hex");
      expected = Buffer.from(hashHex, "hex");
    } catch {
      return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;
    try {
      const derived = scryptHash(String(password), salt);
      return timingSafeEqualBuffers(derived, expected);
    } catch {
      // A runtime scrypt failure must read as "wrong password" (fail closed),
      // never as an unhandled 500 that leaks a misconfiguration.
      return false;
    }
  }

  // Legacy sha256(path\npassword) verifier.
  const computed = sha256Hex(`${String(legacySalt || "")}\n${String(password)}`);
  return timingSafeEqualHex(computed, verifier);
}
