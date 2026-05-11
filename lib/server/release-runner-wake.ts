import type { ReleaseJobRow } from "./release-jobs-service.ts";

export type ReleaseRunnerWakeResult = {
  configured: boolean;
  ok: boolean;
  status: number;
  error: string;
};

type WakeEnv = Record<string, string | undefined>;

function readWakeEnv(env: WakeEnv, name: string): string {
  return String(env[name] || "").trim();
}

function normalizeWakeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function wakeResult(input: Partial<ReleaseRunnerWakeResult>): ReleaseRunnerWakeResult {
  return {
    configured: input.configured ?? false,
    error: input.error ?? "",
    ok: input.ok ?? false,
    status: input.status ?? 0,
  };
}

export async function wakeReleaseRunnerForJob(
  job: ReleaseJobRow,
  options: {
    env?: WakeEnv;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<ReleaseRunnerWakeResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeWakeUrl(readWakeEnv(env, "RELEASE_RUNNER_WAKE_URL"));
  if (!baseUrl) return wakeResult({ configured: false });

  const token = readWakeEnv(env, "RELEASE_RUNNER_WAKE_TOKEN");
  if (!token) {
    return wakeResult({
      configured: true,
      error: "RELEASE_RUNNER_WAKE_TOKEN is not configured.",
      status: 503,
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const cfAccessClientId = readWakeEnv(env, "RELEASE_RUNNER_CF_ACCESS_CLIENT_ID");
  const cfAccessClientSecret = readWakeEnv(env, "RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET");
  if (cfAccessClientId && cfAccessClientSecret) {
    headers["CF-Access-Client-Id"] = cfAccessClientId;
    headers["CF-Access-Client-Secret"] = cfAccessClientSecret;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs ?? 4000));
  try {
    const response = await fetchImpl(`${baseUrl}/wake`, {
      body: JSON.stringify({ action: job.action, jobId: job.id }),
      headers,
      method: "POST",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error || "")
        : response.ok
          ? ""
          : `HTTP ${response.status}`;
    return wakeResult({
      configured: true,
      error: message,
      ok: response.ok,
      status: response.status,
    });
  } catch (error) {
    return wakeResult({
      configured: true,
      error: error instanceof Error ? error.message : String(error),
      status: 0,
    });
  } finally {
    clearTimeout(timeout);
  }
}
