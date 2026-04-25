import {
  hasCloudflareApiDeployConfig,
  resolveCloudflareTargetEnv,
  resolveCloudflareWorkerName,
} from "./cloudflare-deploy-env.ts";

export type DeployHookResult = {
  ok: boolean;
  status: number;
  text: string;
  attempts: number;
  provider: DeployProvider;
  deploymentId?: string;
};

export type DeployProvider = "generic" | "vercel" | "cloudflare";

const MISSING_DEPLOY_TARGET_ERROR = "Missing DEPLOY_HOOK_URL";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 350;

type TriggerDeployHookOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  provider?: DeployProvider;
  message?: string;
};

type CloudflareDeployConfig = {
  accountId: string;
  apiToken: string;
  workerName: string;
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
    return { ok: res.ok, status: res.status, text, provider: "generic" };
  } catch (e: unknown) {
    if (isAbortError(e)) {
      return {
        ok: false,
        status: 504,
        text: `Deploy hook request timed out after ${timeoutMs}ms`,
        provider: "generic",
      };
    }
    return {
      ok: false,
      status: 503,
      text: errorMessage(e),
      provider: "generic",
    };
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDeployProvider(value: unknown): DeployProvider | null {
  const raw = asString(value).toLowerCase();
  if (raw === "cloudflare") return "cloudflare";
  if (raw === "vercel") return "vercel";
  if (raw === "generic") return "generic";
  return null;
}

function resolveDeployProvider(explicit?: DeployProvider): DeployProvider {
  if (explicit) return explicit;
  const envProvider = parseDeployProvider(process.env.DEPLOY_PROVIDER);
  if (envProvider) return envProvider;
  if (hasCloudflareApiDeployConfig(process.env)) {
    return "cloudflare";
  }
  return "generic";
}

function resolveHookUrl(hookUrlRaw: string | undefined): string {
  if (hookUrlRaw !== undefined) return asString(hookUrlRaw);
  return asString(process.env.DEPLOY_HOOK_URL);
}

function readCloudflareDeployConfig():
  | { ok: true; config: CloudflareDeployConfig }
  | { ok: false; missing: string[] } {
  const accountId = asString(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID);
  const apiToken = asString(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN);
  const workerName = resolveCloudflareWorkerName(process.env);
  const targetEnv = resolveCloudflareTargetEnv(process.env);
  const missing: string[] = [];
  if (!accountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!apiToken) missing.push("CLOUDFLARE_API_TOKEN");
  if (!workerName) {
    missing.push(
      targetEnv === "staging"
        ? "CLOUDFLARE_WORKER_NAME_STAGING (or CLOUDFLARE_WORKER_NAME)"
        : "CLOUDFLARE_WORKER_NAME_PRODUCTION (or CLOUDFLARE_WORKER_NAME)",
    );
  }
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    config: {
      accountId,
      apiToken,
      workerName,
    },
  };
}

function isCloudflareSuccessEnvelope(value: unknown): boolean {
  return asRecord(value).success === true;
}

function readCloudflareErrorMessage(value: unknown, fallback: string): string {
  const body = asRecord(value);
  const errors = Array.isArray(body.errors) ? body.errors : [];
  for (const e of errors) {
    const message = asString(asRecord(e).message);
    if (message) return message;
  }
  return fallback;
}

function cloudflareApiUrl(config: CloudflareDeployConfig, path: string): string {
  const rel = path.startsWith("/") ? path : `/${path}`;
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    config.accountId,
  )}${rel}`;
}

async function cloudflareApiRequest(input: {
  config: CloudflareDeployConfig;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}): Promise<{
  ok: boolean;
  status: number;
  raw: unknown;
  text: string;
}> {
  const response = await fetch(cloudflareApiUrl(input.config, input.path), {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.config.apiToken}`,
      "Content-Type": "application/json",
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    cache: "no-store",
  }).catch((err: unknown) => {
    return {
      ok: false,
      status: 503,
      raw: null,
      text: errorMessage(err),
    };
  });

  if (!(response instanceof Response)) {
    return response;
  }

  const raw = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status || 502,
      raw,
      text: readCloudflareErrorMessage(raw, `Cloudflare API failed with ${response.status}`),
    };
  }
  if (!isCloudflareSuccessEnvelope(raw)) {
    return {
      ok: false,
      status: response.status || 502,
      raw,
      text: readCloudflareErrorMessage(raw, "Cloudflare API returned success=false"),
    };
  }
  return {
    ok: true,
    status: response.status || 200,
    raw,
    text: "",
  };
}

function pickLatestVersionId(raw: unknown): string {
  const result = asRecord(raw).result;
  const payload = asRecord(result);
  const items = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(result)
      ? (result as unknown[])
      : [];
  for (const item of items) {
    const id = asString(asRecord(item).id);
    if (id) return id;
  }
  return "";
}

function pickDeploymentId(raw: unknown): string {
  const result = asRecord(raw).result;
  return asString(asRecord(result).id);
}

async function triggerCloudflareDeployment(
  config: CloudflareDeployConfig,
  options?: TriggerDeployHookOptions,
): Promise<DeployHookResult> {
  const versions = await cloudflareApiRequest({
    config,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(config.workerName)}/versions`,
  });
  if (!versions.ok) {
    return {
      ok: false,
      status: versions.status,
      text: versions.text,
      attempts: 1,
      provider: "cloudflare",
    };
  }

  const latestVersionId = pickLatestVersionId(versions.raw);
  if (!latestVersionId) {
    return {
      ok: false,
      status: 424,
      text: "No uploaded Worker version available to deploy",
      attempts: 1,
      provider: "cloudflare",
    };
  }

  const message =
    asString(options?.message) ||
    asString(process.env.DEPLOY_MESSAGE) ||
    "Deploy from site-admin";
  const deployPath = `/workers/scripts/${encodeURIComponent(config.workerName)}/deployments`;
  const baseBody = {
    strategy: "percentage",
    versions: [{ percentage: 100, version_id: latestVersionId }],
  };

  let deploy = await cloudflareApiRequest({
    config,
    method: "POST",
    path: deployPath,
    body: {
      ...baseBody,
      annotations: {
        "workers/message": message,
      },
    },
  });
  if (!deploy.ok && deploy.text.toLowerCase().includes("annotation")) {
    deploy = await cloudflareApiRequest({
      config,
      method: "POST",
      path: deployPath,
      body: baseBody,
    });
  }
  if (!deploy.ok) {
    return {
      ok: false,
      status: deploy.status,
      text: deploy.text,
      attempts: 1,
      provider: "cloudflare",
    };
  }

  const deploymentId = pickDeploymentId(deploy.raw);
  return {
    ok: true,
    status: deploy.status,
    text: deploymentId
      ? `Deployed version ${latestVersionId} as deployment ${deploymentId}`
      : `Deployed version ${latestVersionId}`,
    attempts: 1,
    provider: "cloudflare",
    ...(deploymentId ? { deploymentId } : {}),
  };
}

export async function triggerDeployHook(
  hookUrlRaw?: string,
  options?: TriggerDeployHookOptions,
): Promise<DeployHookResult> {
  const provider = resolveDeployProvider(options?.provider);
  const resolvedHookUrl = resolveHookUrl(hookUrlRaw);

  if (provider === "cloudflare") {
    const cloudflare = readCloudflareDeployConfig();
    if (cloudflare.ok) {
      return triggerCloudflareDeployment(cloudflare.config, options);
    }
    if (!resolvedHookUrl) {
      return {
        ok: false,
        status: 500,
        text: `Missing Cloudflare deploy config: ${cloudflare.missing.join(", ")}`,
        attempts: 0,
        provider,
      };
    }
  }

  if (!resolvedHookUrl) {
    return {
      ok: false,
      status: 500,
      text: MISSING_DEPLOY_TARGET_ERROR,
      attempts: 0,
      provider,
    };
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
    provider,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await postDeployHook(resolvedHookUrl, timeoutMs);
    last = { ...current, provider, attempts: attempt };
    if (current.ok) return last;
    if (attempt >= maxAttempts) break;
    if (!isRetryableStatus(current.status)) break;
    await sleep(backoffDelayMs(attempt, retryBaseDelayMs));
  }

  return last;
}
