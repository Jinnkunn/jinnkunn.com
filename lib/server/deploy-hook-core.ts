export type DeployHookResult = {
  ok: boolean;
  status: number;
  text: string;
  attempts: number;
};

const MISSING_DEPLOY_HOOK_ERROR = "Missing VERCEL_DEPLOY_HOOK_URL";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 350;

type TriggerDeployHookOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function normalizeAttempts(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.min(5, Math.trunc(n)));
}

function normalizeTimeout(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(60_000, Math.trunc(n)));
}

function normalizeRetryBaseDelay(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RETRY_BASE_DELAY_MS;
  return Math.max(100, Math.min(5_000, Math.trunc(n)));
}

function backoffDelayMs(attempt: number, baseDelayMs: number): number {
  return Math.min(10_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const record = e as { name?: unknown };
  return String(record.name || "").toLowerCase() === "aborterror";
}

function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const msg = String((e as { message?: unknown }).message || "").trim();
    if (msg) return msg;
  }
  return "Deploy hook request failed";
}

async function postDeployHook(url: string, timeoutMs: number): Promise<Omit<DeployHookResult, "attempts">> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  } catch (e: unknown) {
    if (isAbortError(e)) {
      return {
        ok: false,
        status: 504,
        text: `Deploy hook request timed out after ${timeoutMs}ms`,
      };
    }
    return {
      ok: false,
      status: 503,
      text: errorMessage(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function triggerDeployHook(
  hookUrlRaw = process.env.VERCEL_DEPLOY_HOOK_URL?.trim() ?? "",
  options?: TriggerDeployHookOptions,
): Promise<DeployHookResult> {
  if (!hookUrlRaw) {
    return { ok: false, status: 500, text: MISSING_DEPLOY_HOOK_ERROR, attempts: 0 };
  }

  const timeoutMs = normalizeTimeout(
    options?.timeoutMs ?? readPositiveIntEnv("DEPLOY_HOOK_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  );
  const maxAttempts = normalizeAttempts(
    options?.maxAttempts ?? readPositiveIntEnv("DEPLOY_HOOK_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
  );
  const retryBaseDelayMs = normalizeRetryBaseDelay(
    options?.retryBaseDelayMs ??
      readPositiveIntEnv("DEPLOY_HOOK_RETRY_BASE_DELAY_MS", DEFAULT_RETRY_BASE_DELAY_MS),
  );

  let last: DeployHookResult = {
    ok: false,
    status: 502,
    text: "Failed to trigger deploy hook",
    attempts: 0,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await postDeployHook(hookUrlRaw, timeoutMs);
    last = { ...current, attempts: attempt };
    if (current.ok) return last;
    if (attempt >= maxAttempts) break;
    if (!isRetryableStatus(current.status)) break;
    await sleep(backoffDelayMs(attempt, retryBaseDelayMs));
  }

  return last;
}
