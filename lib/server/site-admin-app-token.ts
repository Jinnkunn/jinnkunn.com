import crypto from "node:crypto";

type SiteAdminAppTokenPayload = {
  iss: "site-admin";
  aud: "site-admin-app";
  sub: string;
  iat: number;
  exp: number;
};

export type SiteAdminAppTokenIssueResult = {
  token: string;
  expiresAt: string;
};

export type SiteAdminAppTokenVerifyResult =
  | { ok: true; login: string; expiresAt: string }
  | { ok: false; error: string };

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function getTokenSecret(): string {
  const secret = String(
    process.env.SITE_ADMIN_APP_TOKEN_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      process.env.AUTH_SECRET ||
      "",
  ).trim();
  return secret;
}

function signToken(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data, "utf8").digest("base64url");
}

function toLogin(raw: unknown): string {
  return String(raw || "").trim().toLowerCase();
}

function toExpiresAtIso(exp: number): string {
  return new Date(exp * 1000).toISOString();
}

export function issueSiteAdminAppToken(
  login: string,
  opts?: { ttlSeconds?: number },
): SiteAdminAppTokenIssueResult {
  const secret = getTokenSecret();
  if (!secret) {
    throw new Error("SITE_ADMIN_APP_TOKEN_SECRET or NEXTAUTH_SECRET is required");
  }

  const normalizedLogin = toLogin(login);
  if (!normalizedLogin) throw new Error("Missing login for app token");
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.floor(opts?.ttlSeconds || DEFAULT_TOKEN_TTL_SECONDS));
  const payload: SiteAdminAppTokenPayload = {
    iss: "site-admin",
    aud: "site-admin-app",
    sub: normalizedLogin,
    iat: now,
    exp: now + ttl,
  };

  const header = { alg: "HS256", typ: "JWT" as const };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = signToken(`${headerPart}.${payloadPart}`, secret);
  return {
    token: `${headerPart}.${payloadPart}.${signature}`,
    expiresAt: toExpiresAtIso(payload.exp),
  };
}

function verifySignature(
  inputSignature: string,
  expectedSignature: string,
): boolean {
  const a = Buffer.from(inputSignature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifySiteAdminAppToken(token: string): SiteAdminAppTokenVerifyResult {
  const rawToken = String(token || "").trim();
  if (!rawToken) return { ok: false, error: "Missing app token" };
  const parts = rawToken.split(".");
  if (parts.length !== 3) return { ok: false, error: "Invalid app token format" };

  const secret = getTokenSecret();
  if (!secret) {
    return { ok: false, error: "Missing SITE_ADMIN_APP_TOKEN_SECRET/NEXTAUTH_SECRET" };
  }

  const [headerPart, payloadPart, signature] = parts;
  const expected = signToken(`${headerPart}.${payloadPart}`, secret);
  if (!verifySignature(signature, expected)) {
    return { ok: false, error: "Invalid app token signature" };
  }

  let payload: SiteAdminAppTokenPayload | null = null;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as SiteAdminAppTokenPayload;
  } catch {
    return { ok: false, error: "Invalid app token payload" };
  }

  if (!payload || payload.iss !== "site-admin" || payload.aud !== "site-admin-app") {
    return { ok: false, error: "Invalid app token audience" };
  }
  const login = toLogin(payload.sub);
  if (!login) return { ok: false, error: "Invalid app token subject" };
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    return { ok: false, error: "App token expired" };
  }

  return { ok: true, login, expiresAt: toExpiresAtIso(payload.exp) };
}
