import "server-only";

export type DeployHookResult = {
  ok: boolean;
  status: number;
  text: string;
};

const MISSING_DEPLOY_HOOK_ERROR = "Missing VERCEL_DEPLOY_HOOK_URL";

export async function triggerDeployHook(
  hookUrlRaw = process.env.VERCEL_DEPLOY_HOOK_URL?.trim() ?? "",
): Promise<DeployHookResult> {
  if (!hookUrlRaw) {
    return { ok: false, status: 500, text: MISSING_DEPLOY_HOOK_ERROR };
  }

  const res = await fetch(hookUrlRaw, { method: "POST" });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}
