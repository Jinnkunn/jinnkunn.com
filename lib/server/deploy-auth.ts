import crypto from "node:crypto";

const SIGNATURE_HEADER = "x-deploy-signature";
const TIMESTAMP_HEADER = "x-deploy-ts";
const TIMESTAMP_MAX_SKEW_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_GC_INTERVAL_MS = 30 * 1000;

type RateLimitEntry = {
  count: number;
  resetAtMs: number;
};

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

type DeployAuthResult =
  | { ok: true; ip: string }
  | { ok: false; status: 400 | 401 | 429; error: string; retryAfterSec?: number };

type DeployRateLimitGlobal = typeof globalThis & {
  __deployRateLimitStore?: Map<string, RateLimitEntry>;
  __deployRateLimitLastGcMs?: number;
};

function normalizeHeader(value: string | null): string {
  return String(value || "").trim();
}

function normalizeSignature(sig: string): string {
  const s = normalizeHeader(sig).toLowerCase();
  if (s.startsWith("sha256=")) return s.slice("sha256=".length);
  return s;
}

function parseTimestampMs(rawTimestamp: string): number | null {
  const raw = normalizeHeader(rawTimestamp);
  if (!raw) return null;
  if (!/^\d{10,16}$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  // 10 digits: seconds; >= 13 digits: milliseconds.
  return raw.length <= 10 ? value * 1000 : value;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const aa = Buffer.from(normalizeSignature(a), "utf8");
  const bb = Buffer.from(normalizeSignature(b), "utf8");
  if (!aa.length || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function getRateLimitStore(): Map<string, RateLimitEntry> {
  const g = globalThis as DeployRateLimitGlobal;
  if (!g.__deployRateLimitStore) g.__deployRateLimitStore = new Map<string, RateLimitEntry>();
  return g.__deployRateLimitStore;
}

function gcRateLimitStore(nowMs: number) {
  const g = globalThis as DeployRateLimitGlobal;
  if ((g.__deployRateLimitLastGcMs || 0) + RATE_LIMIT_GC_INTERVAL_MS > nowMs) return;
  g.__deployRateLimitLastGcMs = nowMs;
  const store = getRateLimitStore();
  for (const [key, entry] of store) {
    if (entry.resetAtMs <= nowMs) store.delete(key);
  }
}

function checkRateLimit(ip: string, nowMs: number): RateLimitResult {
  gcRateLimitStore(nowMs);
  const store = getRateLimitStore();
  const key = ip || "unknown";
  const current = store.get(key);

  if (!current || current.resetAtMs <= nowMs) {
    store.set(key, {
      count: 1,
      resetAtMs: nowMs + RATE_LIMIT_WINDOW_MS,
    });
    return { ok: true };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterMs = Math.max(0, current.resetAtMs - nowMs);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  current.count += 1;
  store.set(key, current);
  return { ok: true };
}

function expectedSignatureHex(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function requestIpFromHeaders(headers: Headers): string {
  const forwardedFor = normalizeHeader(headers.get("x-forwarded-for"));
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  const realIp = normalizeHeader(headers.get("x-real-ip"));
  if (realIp) return realIp;
  return "unknown";
}

export function verifyDeploySignature(opts: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): boolean {
  const expected = expectedSignatureHex(opts.secret, opts.timestamp, opts.rawBody);
  return timingSafeEqualHex(opts.signature, expected);
}

export function authorizeDeployRequest(
  req: Request,
  rawBody: string,
  secret: string,
  nowMs = Date.now(),
): DeployAuthResult {
  const ip = requestIpFromHeaders(req.headers);
  const rate = checkRateLimit(ip, nowMs);
  if (!rate.ok) {
    return {
      ok: false,
      status: 429,
      error: "Too Many Requests",
      retryAfterSec: rate.retryAfterSec,
    };
  }

  const timestamp = normalizeHeader(req.headers.get(TIMESTAMP_HEADER));
  const signature = normalizeHeader(req.headers.get(SIGNATURE_HEADER));
  if (!timestamp || !signature) {
    return { ok: false, status: 401, error: "Missing deploy signature headers" };
  }

  const timestampMs = parseTimestampMs(timestamp);
  if (!timestampMs) {
    return { ok: false, status: 400, error: "Invalid deploy timestamp" };
  }

  if (Math.abs(nowMs - timestampMs) > TIMESTAMP_MAX_SKEW_MS) {
    return { ok: false, status: 401, error: "Deploy signature expired" };
  }

  const valid = verifyDeploySignature({
    secret,
    timestamp,
    rawBody,
    signature,
  });
  if (!valid) {
    return { ok: false, status: 401, error: "Invalid deploy signature" };
  }

  return { ok: true, ip };
}
