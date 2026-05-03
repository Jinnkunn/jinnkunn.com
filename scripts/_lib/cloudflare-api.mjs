/**
 * Tiny Cloudflare REST helper for the release scripts.
 *
 * Centralises the bits that were copy-pasted across release-from-staging
 * and (now) release-cloudflare's auto-rollback pre-fetch:
 *   - `cfRequest`        — JSON-aware fetch + envelope unwrap.
 *   - `pickFirst`        — list-endpoint shape normaliser (CF wraps
 *                          arrays under a key whose name varies).
 *   - `readActiveDeployment` — returns the active deployment id, primary
 *                          version id, and its annotation message for a
 *                          named Worker.
 *
 * Keeping these here means a CF API quirk (envelope rename, new array
 * key, retry semantics) gets fixed once instead of in three scripts.
 */

import { parseDeployMessage } from "./deploy-metadata.mjs";

export async function cfRequest({ accountId, apiToken, method = "GET", path: apiPath }) {
  if (!accountId) throw new Error("cfRequest: missing accountId");
  if (!apiToken) throw new Error("cfRequest: missing apiToken");
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${apiPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Cloudflare API ${method} ${apiPath} returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
  if (!response.ok || !payload || payload.success === false) {
    const errors =
      payload?.errors?.map((e) => e.message).join("; ") ||
      text ||
      response.statusText;
    throw new Error(
      `Cloudflare API ${method} ${apiPath} failed (${response.status}): ${errors}`,
    );
  }
  return payload.result ?? payload;
}

// CF list endpoints sometimes wrap arrays under type-specific keys
// (`{ deployments: [...] }`, `{ items: [...] }`). Walk all array values
// so this stays resilient to whichever key the API picks.
export function pickFirst(payload) {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (!payload || typeof payload !== "object") return null;
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.length > 0) return value[0];
  }
  return null;
}

/**
 * Fetch the currently-active deployment for a Worker script and return
 * its primary version id, deployment id, and the annotation message
 * (already parsed into the `meta` shape from deploy-metadata.mjs).
 *
 * Returns `null` when the worker has no active deployment yet.
 */
export async function readActiveDeployment({ accountId, apiToken, workerName }) {
  if (!workerName) throw new Error("readActiveDeployment: missing workerName");
  const deployments = await cfRequest({
    accountId,
    apiToken,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
  });
  const active = pickFirst(deployments);
  if (!active) return null;
  const versions = Array.isArray(active.versions) ? active.versions : [];
  versions.sort(
    (a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0),
  );
  const primary = versions[0];
  if (!primary?.version_id) return null;
  const versionDetail = await cfRequest({
    accountId,
    apiToken,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(primary.version_id)}`,
  });
  const annotations = (versionDetail && versionDetail.annotations) || {};
  const message = annotations["workers/message"] || versionDetail?.message || "";
  return {
    deploymentId: String(active.id || ""),
    versionId: primary.version_id,
    versionMessage: message,
    meta: parseDeployMessage(message),
  };
}
