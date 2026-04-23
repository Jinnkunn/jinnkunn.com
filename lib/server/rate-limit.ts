/**
 * Process-scope rate limiter.
 *
 * Pre-existed in `lib/server/deploy-auth.ts` as a deploy-endpoint-only
 * helper. Lifted here because the rest of the admin API surface
 * (config / routes / deploy-preview / status / app-auth) also needs
 * per-IP throttling — an attacker who extracts a session cookie should
 * not be able to brute-force the admin mutations unchecked.
 *
 * The store lives on `globalThis` so it survives module reloads in
 * dev and hot code reloads in Workers. Each `namespace` gets its own
 * Map so unrelated endpoints don't share buckets. The periodic GC
 * prevents the store from growing unboundedly across long-lived
 * isolates.
 *
 * Notes on the runtime model:
 * - Workers isolates do share a process across requests within a
 *   region, so this gives meaningful protection on Cloudflare too.
 * - Vercel Fluid Compute also reuses instances, so the same applies.
 * - In traditional one-request-per-instance serverless, each cold
 *   boot resets the counter — acceptable since cold boots are already
 *   throttled at the provider level.
 */

export type RateLimitOptions = {
  /** Bucket key, e.g. "deploy" or "site-admin-config". */
  namespace: string;
  /** Caller IP (fall back to "unknown" if missing). */
  ip: string;
  /** Max requests permitted per window. */
  maxRequests: number;
  /** Window length in ms. */
  windowMs: number;
  /** Current time; exposed for deterministic testing. */
  nowMs?: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

type RateLimitEntry = {
  count: number;
  resetAtMs: number;
};

type RateLimitNamespace = {
  store: Map<string, RateLimitEntry>;
  lastGcMs: number;
};

type RateLimitGlobal = typeof globalThis & {
  __rateLimitNamespaces?: Map<string, RateLimitNamespace>;
};

const GC_INTERVAL_MS = 30_000;

function getNamespace(name: string): RateLimitNamespace {
  const g = globalThis as RateLimitGlobal;
  if (!g.__rateLimitNamespaces) g.__rateLimitNamespaces = new Map();
  let ns = g.__rateLimitNamespaces.get(name);
  if (!ns) {
    ns = { store: new Map(), lastGcMs: 0 };
    g.__rateLimitNamespaces.set(name, ns);
  }
  return ns;
}

function gcNamespace(ns: RateLimitNamespace, nowMs: number): void {
  if (ns.lastGcMs + GC_INTERVAL_MS > nowMs) return;
  ns.lastGcMs = nowMs;
  for (const [key, entry] of ns.store) {
    if (entry.resetAtMs <= nowMs) ns.store.delete(key);
  }
}

export function checkRateLimit(opts: RateLimitOptions): RateLimitResult {
  const nowMs = opts.nowMs ?? Date.now();
  const ns = getNamespace(opts.namespace);
  gcNamespace(ns, nowMs);

  const key = opts.ip || "unknown";
  const current = ns.store.get(key);

  if (!current || current.resetAtMs <= nowMs) {
    ns.store.set(key, { count: 1, resetAtMs: nowMs + opts.windowMs });
    return { ok: true };
  }

  if (current.count >= opts.maxRequests) {
    const retryAfterMs = Math.max(0, current.resetAtMs - nowMs);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  current.count += 1;
  ns.store.set(key, current);
  return { ok: true };
}

/**
 * Test-only escape hatch. Clears every bucket so tests that share the
 * process don't interfere with each other.
 */
export function resetRateLimitForTests(): void {
  const g = globalThis as RateLimitGlobal;
  g.__rateLimitNamespaces = new Map();
}

export function requestIpFromHeaders(headers: Headers): string {
  const forwardedFor = String(headers.get("x-forwarded-for") || "").trim();
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  const realIp = String(headers.get("x-real-ip") || "").trim();
  if (realIp) return realIp;
  return "unknown";
}
