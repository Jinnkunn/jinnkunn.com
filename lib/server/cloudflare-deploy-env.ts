function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEnvName(value: unknown): "staging" | "production" | null {
  const raw = asString(value).toLowerCase();
  if (raw === "staging") return "staging";
  if (raw === "production" || raw === "prod") return "production";
  return null;
}

export function resolveCloudflareTargetEnv(
  env: NodeJS.ProcessEnv = process.env,
): "staging" | "production" {
  return (
    normalizeEnvName(env.CLOUDFLARE_DEPLOY_ENV) ||
    normalizeEnvName(env.DEPLOY_ENV) ||
    "staging"
  );
}

export function resolveCloudflareWorkerName(env: NodeJS.ProcessEnv = process.env): string {
  const target = resolveCloudflareTargetEnv(env);
  if (target === "staging") {
    return asString(env.CLOUDFLARE_WORKER_NAME_STAGING || env.CLOUDFLARE_WORKER_NAME);
  }
  return asString(env.CLOUDFLARE_WORKER_NAME_PRODUCTION || env.CLOUDFLARE_WORKER_NAME);
}

export function hasCloudflareApiDeployConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const accountId = asString(env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID);
  const apiToken = asString(env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN);
  const workerName = resolveCloudflareWorkerName(env);
  return Boolean(accountId && apiToken && workerName);
}
