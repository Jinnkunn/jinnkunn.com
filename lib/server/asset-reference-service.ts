import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadPublishedSnapshot, loadSavedSnapshot } from "./publication-review-service";
import { readAssetReferenceSnapshots } from "./asset-reference-snapshots";
import type { D1DatabaseLike } from "./d1-executor";
import { findAssetReferences, type AssetReferenceSnapshot } from "../shared/asset-references";

export async function loadAssetUsage(assets: { key: string; url: string }[]) {
  try {
    let snapshots: AssetReferenceSnapshot[];
    if (process.env.SITE_ADMIN_STORAGE === "db") {
      const env = getCloudflareContext().env as unknown as Record<string, D1DatabaseLike | undefined>;
      const production = Boolean(env.SITE_ADMIN_RELEASE_DB);
      const own = env.SITE_ADMIN_DB;
      const other = production ? env.SITE_ADMIN_RELEASE_DB : env.SITE_ADMIN_DB_LIVE;
      if (!own || !other) throw new Error("Both media reference databases are required.");
      snapshots = [
        ...await readAssetReferenceSnapshots(own, production ? "production" : "staging"),
        ...await readAssetReferenceSnapshots(other, production ? "staging" : "production"),
      ];
    } else {
      snapshots = [
        { ...(await loadSavedSnapshot()), environment: "local", state: "draft" },
        { ...(await loadPublishedSnapshot()), environment: "local", state: "published" },
      ];
    }
    return { verified: true, references: findAssetReferences(assets, snapshots) };
  } catch {
    // A partial scan must never be interpreted as an unused, deletable file.
    return { verified: false, references: {} };
  }
}
