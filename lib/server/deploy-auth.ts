import crypto from "node:crypto";

import { checkRateLimit, requestIpFromHeaders } from "./rate-limit.ts";

const SIGNATURE_HEADER = "x-deploy-signature";
const TIMESTAMP_HEADER = "x-deploy-ts";
const TIMESTAMP_MAX_SKEW_MS = 5 * 60 * 1000;
const RATE_LIMIT_NAMESPACE = "deploy";
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

type DeployAuthResult =
  | { ok: true; ip: string }
  | { ok: false; status: 400 | 401 | 429; error: string; retryAfterSec?: number };

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

function expectedSignatureHex(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

// Re-export so existing callers (app/api/deploy/route.ts) keep the same
// import path instead of learning about the shared helper.
export { requestIpFromHeaders };

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
  const rate = checkRateLimit({
    namespace: RATE_LIMIT_NAMESPACE,
    ip,
    maxRequests: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
    nowMs,
  });
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
