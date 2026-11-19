import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SiteAdminStatusPayload } from "@jinnkunn/contracts/api";
import { PUBLICATION_BASELINE_PATH } from "../shared/publication-snapshot";
import { activeOverlayTable, workerOverlayKey } from "../shared/static-release";
import { createD1Executor, type D1DatabaseLike } from "./d1-executor";

export async function readSiteAdminLivePublication(): Promise<SiteAdminStatusPayload["livePublication"]> {
  try {
    const { env } = getCloudflareContext();
    const workerVersionId = workerOverlayKey(env);
    const bindings = env as { SITE_ADMIN_DB?: D1DatabaseLike; SITE_ADMIN_RELEASE_DB?: D1DatabaseLike; STAGING_GATE?: string };
    if (!workerVersionId || !bindings.SITE_ADMIN_DB) return undefined;
    const receipt = { workerVersionId, snapshotSha: null as string | null, verifiedAt: null as string | null };
    const baseline = await createD1Executor(bindings.SITE_ADMIN_DB).execute({
      sql: `SELECT json_extract(body, '$.sha') AS sha FROM ${activeOverlayTable(workerVersionId)} WHERE asset_path = ?`,
      args: [PUBLICATION_BASELINE_PATH],
    }).catch(() => null);
    const sha = baseline?.rows[0]?.sha;
    if (typeof sha !== "string" || !/^[a-f0-9]{64}$/.test(sha)) return receipt;
    receipt.snapshotSha = sha;

    const target = bindings.SITE_ADMIN_RELEASE_DB ? "production" : bindings.STAGING_GATE === "1" ? "staging" : null;
    if (!target) return receipt;
    // A prior pass only proves the exact pair now serving. Activation times
    // and rollback records are not publication verification receipts.
    const history = await createD1Executor(bindings.SITE_ADMIN_RELEASE_DB ?? bindings.SITE_ADMIN_DB).execute({
      sql: `SELECT recorded_at FROM release_history
            WHERE env = ? AND ok = 1 AND deployed_version_id = ?
              AND (json_extract(detail_json, '$.publicVerification.snapshotSha') = ?
                OR json_extract(detail_json, '$.codeOverlay.serving.searchSnapshotSha') = ?)
            ORDER BY recorded_at DESC LIMIT 1`,
      args: [target, workerVersionId, sha, sha],
    }).catch(() => null);
    const verifiedAt = new Date(Number(history?.rows[0]?.recorded_at ?? NaN));
    if (Number.isFinite(verifiedAt.getTime()) && verifiedAt.getTime() > 0) receipt.verifiedAt = verifiedAt.toISOString();
    return receipt;
  } catch {
    return undefined;
  }
}
