import crypto from "node:crypto";
import { pickStaticProtectedRule } from "../../cloudflare/static-shell-protection.mjs";
import { shouldBypassStatic } from "../../cloudflare/worker-entry-guards.mjs";

const digest = (body) => crypto.createHash("sha1").update(body).digest("hex");

export function overlayVerificationTargets(rows) {
  const policyRow = rows.find((row) => row.asset_path === "/__static/protected-routes-policy.json");
  const policy = policyRow ? JSON.parse(policyRow.body) : null;
  const targets = new Map();
  for (const row of rows) {
    const assetPath = String(row.asset_path || "");
    if (!assetPath.startsWith("/__static/") || !assetPath.endsWith(".html")) continue;
    let pathname = assetPath.slice("/__static".length, -".html".length);
    if (pathname === "/index") pathname = "/";
    else if (pathname.endsWith("/index")) pathname = pathname.slice(0, -"/index".length);
    if (shouldBypassStatic(pathname)) continue;
    if (pickStaticProtectedRule(pathname, policy)) continue;
    const expectedSha = digest(String(row.body));
    if (row.content_sha && row.content_sha !== expectedSha) {
      throw new Error(`Overlay body fingerprint does not match stored metadata: ${assetPath}`);
    }
    // The Worker tries /route.html before /route/index.html when both exist.
    if (!targets.has(pathname) || assetPath === `/__static${pathname}.html`) {
      targets.set(pathname, { path: pathname, assetPath, expectedSha });
    }
  }
  if (!targets.has("/")) throw new Error("Overlay verification requires a homepage shell.");
  return [...targets.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function verifyOverlayContent({
  origin, rows, cookie = "", fetchImpl = fetch, attempts = 8,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 15_000,
}) {
  const targets = overlayVerificationTargets(rows);
  const verified = new Map();
  let failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    failures = [];
    for (const target of targets) {
      if (verified.has(target.path)) continue;
      let result;
      try {
        const response = await fetchImpl(`${origin}${target.path}`, {
          redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
          headers: { "cache-control": "no-cache", ...(cookie ? { cookie } : {}) },
        });
        const actualSha = digest(Buffer.from(await response.arrayBuffer()));
        result = {
          ...target, status: response.status, actualSha,
          staticShell: response.headers.get("x-static-shell") || "",
          staticOverlay: response.headers.get("x-static-overlay") || "",
          servedAssetPath: response.headers.get("x-static-shell-path") || "",
          etag: response.headers.get("etag") || "",
        };
        // CDNs may omit or weaken ETags; the decoded response bytes remain authoritative.
        const etagMatches = !result.etag || result.etag.replace(/^W\//, "") === `"${target.expectedSha}"`;
        result.ok = result.status === 200 && result.staticShell === "1" &&
          result.staticOverlay === "1" && result.servedAssetPath === target.assetPath &&
          etagMatches && actualSha === target.expectedSha;
      } catch (error) {
        result = { ...target, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (result.ok) verified.set(target.path, result);
      else failures.push(result);
    }
    if (!failures.length) {
      return { ok: true, attempts: attempt, routes: targets.map((target) => verified.get(target.path)) };
    }
    if (attempt < attempts) await wait(2_000);
  }
  throw new Error(`Overlay content verification failed: ${JSON.stringify(failures)}`);
}
