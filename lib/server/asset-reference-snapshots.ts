import type { D1DatabaseLike } from "./d1-executor.ts";
import { PUBLICATION_BASELINE_PATH, isPublicationSource } from "../shared/publication-snapshot.ts";
import type { AssetReferenceSnapshot, AssetReference } from "../shared/asset-references.ts";

export async function readAssetReferenceSnapshots(db: D1DatabaseLike, environment: AssetReference["environment"]): Promise<AssetReferenceSnapshot[]> {
  // One statement observes saved and published content at the same instant.
  const legacy = "SELECT rel_path AS path, hex(body) AS body_hex, 'draft' AS state FROM content_files UNION ALL SELECT asset_path AS path, hex(body) AS body_hex, 'published' AS state FROM static_shell_overlays WHERE asset_path = ?";
  type ScanRow = { path: string; body_hex: string; state: string };
  let results: ScanRow[] | undefined;
  try {
    ({ results } = await db.prepare(`${legacy} UNION ALL
      SELECT asset_path, hex(body), 'published' FROM static_shell_overlay_versions v WHERE asset_path = ?
      AND EXISTS (SELECT 1 FROM static_shell_overlay_active a WHERE v.snapshot_id IN (a.snapshot_id, a.previous_snapshot_id))`)
      .bind(PUBLICATION_BASELINE_PATH, PUBLICATION_BASELINE_PATH).all<ScanRow>());
  } catch (error) {
    if (!String(error).includes("no such table: static_shell_overlay_active")) throw error;
    ({ results } = await db.prepare(legacy).bind(PUBLICATION_BASELINE_PATH).all<ScanRow>());
  }
  if (!results) throw new Error("Media reference scan failed.");
  const draft: Record<string, string> = {};
  const published: AssetReferenceSnapshot[] = [];
  for (const row of results) {
    const source = Buffer.from(row.body_hex, "hex").toString("utf8");
    if (row.state === "published") {
      const value = JSON.parse(source);
      if (value.version !== 1 || !value.sources || Array.isArray(value.sources) || typeof value.sources !== "object" ||
          Object.values(value.sources).some((body) => typeof body !== "string")) throw new Error("Published media baseline is invalid.");
      published.push({ environment, state: "published", sources: value.sources });
    } else if (isPublicationSource(row.path)) draft[row.path] = source;
  }
  // Do not substitute this worker's compiled baseline for the other environment.
  if (!published.length) throw new Error("Published media baseline is unavailable.");
  return [{ environment, state: "draft", sources: draft }, ...published];
}
