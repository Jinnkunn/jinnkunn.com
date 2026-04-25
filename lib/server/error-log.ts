/**
 * Minimal in-process error ring-buffer for admin observability.
 *
 * Why not Sentry / OpenTelemetry?
 *   - The site runs on Cloudflare Workers Free, where any external
 *     outbound call competes with the 10ms CPU budget.
 *   - We do not want to block request handling on a third-party log
 *     sink being slow or down.
 *
 * What it gives us:
 *   - Structured `console.warn` / `console.error` lines with a stable
 *     prefix and JSON payload, so anything tailing stderr can
 *     grep/filter it.
 *   - A bounded ring that the admin status endpoint reads to surface
 *     "there were N warnings in the last hour, here's the tail".
 *
 * The ring lives on `globalThis` so it survives module reloads in dev
 * and code-reload in Workers isolates.
 */

type ErrorSeverity = "warn" | "error";

export type LoggedEvent = {
  at: string;
  severity: ErrorSeverity;
  source: string;
  message: string;
  detail?: string;
  meta?: Record<string, unknown>;
};

type ErrorLogGlobal = typeof globalThis & {
  __errorLogRing?: LoggedEvent[];
};

const MAX_RING = 64;

function getRing(): LoggedEvent[] {
  const g = globalThis as ErrorLogGlobal;
  if (!g.__errorLogRing) g.__errorLogRing = [];
  return g.__errorLogRing;
}

function serializeDetail(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLen = 500): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}…`;
}

function push(event: LoggedEvent): void {
  const ring = getRing();
  ring.push(event);
  // Keep the ring bounded without reallocating.
  while (ring.length > MAX_RING) ring.shift();
}

function emit(event: LoggedEvent): void {
  const prefix = `[${event.source}]`;
  const payload = {
    at: event.at,
    severity: event.severity,
    source: event.source,
    message: event.message,
    ...(event.detail ? { detail: event.detail } : {}),
    ...(event.meta ? { meta: event.meta } : {}),
  };
  const line = `${prefix} ${event.message}${event.detail ? ` — ${event.detail}` : ""}`;
  const json = JSON.stringify(payload);
  if (event.severity === "error") {
    console.error(line, json);
  } else {
    console.warn(line, json);
  }
}

export type LogInput = {
  source: string;
  message: string;
  detail?: unknown;
  meta?: Record<string, unknown>;
};

export function logWarn(input: LogInput): void {
  const event: LoggedEvent = {
    at: new Date().toISOString(),
    severity: "warn",
    source: input.source,
    message: input.message,
    detail: truncate(serializeDetail(input.detail)),
    meta: input.meta,
  };
  push(event);
  emit(event);
}

export function logError(input: LogInput): void {
  const event: LoggedEvent = {
    at: new Date().toISOString(),
    severity: "error",
    source: input.source,
    message: input.message,
    detail: truncate(serializeDetail(input.detail)),
    meta: input.meta,
  };
  push(event);
  emit(event);
}

export type ErrorLogSummary = {
  total: number;
  warnCount: number;
  errorCount: number;
  oldestAt: string | null;
  newestAt: string | null;
  recent: Array<Pick<LoggedEvent, "at" | "severity" | "source" | "message" | "detail">>;
};

/**
 * Read the current ring. Admin UI / status endpoint consumes this —
 * the ring is intentionally shallow (no stack traces, no meta for the
 * tail view) so it is safe to surface to authenticated admins
 * without leaking secrets.
 */
export function readErrorLogSummary(tail = 10): ErrorLogSummary {
  const ring = getRing();
  const total = ring.length;
  let warnCount = 0;
  let errorCount = 0;
  for (const ev of ring) {
    if (ev.severity === "warn") warnCount += 1;
    else errorCount += 1;
  }
  const recent = ring
    .slice(-tail)
    .map((ev) => ({
      at: ev.at,
      severity: ev.severity,
      source: ev.source,
      message: ev.message,
      ...(ev.detail ? { detail: ev.detail } : {}),
    }));
  return {
    total,
    warnCount,
    errorCount,
    oldestAt: ring[0]?.at ?? null,
    newestAt: ring[ring.length - 1]?.at ?? null,
    recent,
  };
}

/** Test-only: wipe the ring so tests stay isolated. */
export function resetErrorLogForTests(): void {
  const g = globalThis as ErrorLogGlobal;
  g.__errorLogRing = [];
}
