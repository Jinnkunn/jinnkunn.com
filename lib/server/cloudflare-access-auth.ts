// Verifier for Cloudflare Access JWTs.
//
// Cloudflare Access sits in front of our worker on staging and (eventually)
// production. Once a user authenticates with the configured IdP (GitHub OTP
// email passkey etc.), or once a service token's credentials validate, CF
// injects a signed JWT into our request as `Cf-Access-Jwt-Assertion`.
//
// This module verifies that JWT against the team's JWKS and returns the
// identity (email for humans, `common_name` for service tokens). It is
// intentionally dependency-free (no `jose`) — JWKS shape + RS256 verify are
// tiny in node:crypto.

import crypto from "node:crypto";

export type CloudflareAccessIdentityKind = "user" | "service";

export type CloudflareAccessIdentity = {
  kind: CloudflareAccessIdentityKind;
  /** Email for user tokens, empty for service tokens. */
  email: string;
  /** Human-readable identifier: email for users, `common_name` for service tokens. */
  subject: string;
  /** Access application audience (aud claim). */
  aud: string;
  issuer: string;
  /** Raw claims, exposed for callers that need custom fields (e.g. group membership). */
  claims: Record<string, unknown>;
};

export class CloudflareAccessVerifyError extends Error {
  constructor(reason: string) {
    super(`cloudflare-access: ${reason}`);
    this.name = "CloudflareAccessVerifyError";
  }
}

type JwkRsa = {
  kty: "RSA";
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
};

type JwksCacheEntry = {
  keys: JwkRsa[];
  expiresAtMs: number;
};

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour
const JWKS_CACHE_KEY = "__jkn_cf_access_jwks_cache__";
const JWKS_INFLIGHT_KEY = "__jkn_cf_access_jwks_inflight__";

type CacheHolder = {
  [JWKS_CACHE_KEY]?: Map<string, JwksCacheEntry>;
  [JWKS_INFLIGHT_KEY]?: Map<string, Promise<JwkRsa[]>>;
};

function jwksCache(): Map<string, JwksCacheEntry> {
  const holder = globalThis as CacheHolder;
  if (!holder[JWKS_CACHE_KEY]) holder[JWKS_CACHE_KEY] = new Map();
  return holder[JWKS_CACHE_KEY];
}

function jwksInflight(): Map<string, Promise<JwkRsa[]>> {
  const holder = globalThis as CacheHolder;
  if (!holder[JWKS_INFLIGHT_KEY]) holder[JWKS_INFLIGHT_KEY] = new Map();
  return holder[JWKS_INFLIGHT_KEY];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed;
}

export type CloudflareAccessConfig = {
  teamDomain: string; // e.g. "jinnkunn.cloudflareaccess.com"
  audience: string; // Application AUD tag from CF dashboard
};

export function readCloudflareAccessConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CloudflareAccessConfig | null {
  const teamDomain = normalizeTeamDomain(
    asString(env.CF_ACCESS_TEAM_DOMAIN || env.CLOUDFLARE_ACCESS_TEAM_DOMAIN),
  );
  const audience = asString(env.CF_ACCESS_AUD || env.CLOUDFLARE_ACCESS_AUD).trim();
  if (!teamDomain || !audience) return null;
  return { teamDomain, audience };
}

async function fetchJwks(teamDomain: string): Promise<JwkRsa[]> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new CloudflareAccessVerifyError(
      `jwks fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json().catch(() => null)) as unknown;
  const keysRaw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { keys?: unknown }).keys
      : null;
  if (!Array.isArray(keysRaw)) {
    throw new CloudflareAccessVerifyError("jwks payload missing `keys` array");
  }
  const keys: JwkRsa[] = [];
  for (const raw of keysRaw) {
    if (!raw || typeof raw !== "object") continue;
    const k = raw as Record<string, unknown>;
    if (k.kty !== "RSA") continue;
    const kid = asString(k.kid);
    const n = asString(k.n);
    const e = asString(k.e);
    if (!kid || !n || !e) continue;
    keys.push({
      kty: "RSA",
      kid,
      n,
      e,
      alg: asString(k.alg) || undefined,
      use: asString(k.use) || undefined,
    });
  }
  if (keys.length === 0) {
    throw new CloudflareAccessVerifyError("jwks returned no RSA keys");
  }
  return keys;
}

async function getJwks(teamDomain: string): Promise<JwkRsa[]> {
  const cache = jwksCache();
  const inflight = jwksInflight();
  const cached = cache.get(teamDomain);
  const now = Date.now();
  if (cached && cached.expiresAtMs > now) return cached.keys;
  const pending = inflight.get(teamDomain);
  if (pending) return pending;
  const promise = (async () => {
    const keys = await fetchJwks(teamDomain);
    cache.set(teamDomain, { keys, expiresAtMs: now + JWKS_TTL_MS });
    return keys;
  })().finally(() => {
    inflight.delete(teamDomain);
  });
  inflight.set(teamDomain, promise);
  return promise;
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 2 ? "==" : input.length % 4 === 3 ? "=" : "";
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function jwkToPem(jwk: JwkRsa): string {
  // Build a PKCS#1 SubjectPublicKeyInfo from {n, e}.
  return crypto.createPublicKey({
    key: {
      kty: "RSA",
      n: jwk.n,
      e: jwk.e,
    },
    format: "jwk",
  }).export({ format: "pem", type: "spki" }).toString();
}

function verifyRs256Signature(
  data: string,
  signature: Buffer,
  pem: string,
): boolean {
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(data);
  verifier.end();
  try {
    return verifier.verify(pem, signature);
  } catch {
    return false;
  }
}

/**
 * Verify a Cf-Access-Jwt-Assertion token and return the authenticated
 * identity. Throws on any failure — callers should treat the throw as
 * an unauthenticated request.
 */
export async function verifyCloudflareAccessJwt(
  token: string,
  config: CloudflareAccessConfig,
  opts?: { nowMs?: number; clockSkewSec?: number },
): Promise<CloudflareAccessIdentity> {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new CloudflareAccessVerifyError("malformed JWT");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  let headerObj: Record<string, unknown>;
  let payloadObj: Record<string, unknown>;
  try {
    headerObj = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payloadObj = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new CloudflareAccessVerifyError("JWT header/payload not valid JSON");
  }
  const alg = asString(headerObj.alg).toUpperCase();
  if (alg !== "RS256") {
    throw new CloudflareAccessVerifyError(`unsupported alg: ${alg}`);
  }
  const kid = asString(headerObj.kid);
  if (!kid) throw new CloudflareAccessVerifyError("missing kid");

  const keys = await getJwks(config.teamDomain);
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Refresh once in case the signing key rotated recently.
    jwksCache().delete(config.teamDomain);
    const refreshed = await getJwks(config.teamDomain);
    const next = refreshed.find((k) => k.kid === kid);
    if (!next) throw new CloudflareAccessVerifyError(`unknown kid: ${kid}`);
    return verifyWithKey(
      next,
      headerB64,
      payloadB64,
      signatureB64,
      payloadObj,
      config,
      opts,
    );
  }
  return verifyWithKey(jwk, headerB64, payloadB64, signatureB64, payloadObj, config, opts);
}

async function verifyWithKey(
  jwk: JwkRsa,
  headerB64: string,
  payloadB64: string,
  signatureB64: string,
  payload: Record<string, unknown>,
  config: CloudflareAccessConfig,
  opts: { nowMs?: number; clockSkewSec?: number } = {},
): Promise<CloudflareAccessIdentity> {
  const pem = jwkToPem(jwk);
  const data = `${headerB64}.${payloadB64}`;
  const sig = base64UrlDecode(signatureB64);
  if (!verifyRs256Signature(data, sig, pem)) {
    throw new CloudflareAccessVerifyError("signature verification failed");
  }
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const skew = opts.clockSkewSec ?? 30;
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const nbf = typeof payload.nbf === "number" ? payload.nbf : 0;
  if (exp && exp + skew < now) {
    throw new CloudflareAccessVerifyError("token expired");
  }
  if (nbf && nbf - skew > now) {
    throw new CloudflareAccessVerifyError("token not yet valid");
  }
  const issuerExpected = `https://${config.teamDomain}`;
  const issuer = asString(payload.iss);
  if (issuer !== issuerExpected) {
    throw new CloudflareAccessVerifyError(
      `unexpected issuer: got ${issuer}, expected ${issuerExpected}`,
    );
  }
  const aud = payload.aud;
  const audOk = Array.isArray(aud)
    ? aud.some((a) => a === config.audience)
    : aud === config.audience;
  if (!audOk) {
    throw new CloudflareAccessVerifyError(
      `unexpected audience: expected ${config.audience}`,
    );
  }
  const email = asString(payload.email).toLowerCase();
  const commonName = asString(payload.common_name).toLowerCase();
  const kind: CloudflareAccessIdentityKind =
    email ? "user" : commonName ? "service" : "user";
  const subject = email || commonName || asString(payload.sub);
  if (!subject) {
    throw new CloudflareAccessVerifyError("identity claim missing (email / common_name / sub)");
  }
  return {
    kind,
    email,
    subject,
    aud: config.audience,
    issuer,
    claims: payload,
  };
}

/**
 * Convenience: pull the JWT from a Headers object and verify in one step.
 * Returns null for "no CF Access header present" so callers can treat this as
 * non-authoritative and fall back to other auth paths.
 */
export async function verifyCloudflareAccessFromHeaders(
  headers: Headers,
  config: CloudflareAccessConfig,
  opts?: { nowMs?: number; clockSkewSec?: number },
): Promise<CloudflareAccessIdentity | null> {
  const token =
    headers.get("cf-access-jwt-assertion") ||
    headers.get("Cf-Access-Jwt-Assertion") ||
    "";
  if (!token.trim()) return null;
  return verifyCloudflareAccessJwt(token.trim(), config, opts);
}
