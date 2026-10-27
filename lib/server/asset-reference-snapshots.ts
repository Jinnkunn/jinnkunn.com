import type { D1DatabaseLike } from "./d1-executor.ts";
import { PUBLICATION_BASELINE_PATH, isPublicationSource } from "../shared/publication-snapshot.ts";
import type { AssetReferenceSnapshot, AssetReference } from "../shared/asset-references.ts";

export async function readAssetReferenceSnapshots(db: D1DatabaseLike, environment: AssetReference["environment"]): Promise<AssetReferenceSnapshot[]> {
  // One statement observes saved and published content at the same instant.
  const { results } = await db.prepare("SELECT rel_path AS path, hex(body) AS body_hex, 'draft' AS state FROM content_files UNION ALL SELECT asset_path AS path, hex(body) AS body_hex, 'published' AS state FROM static_shell_overlays WHERE asset_path = ?")
    .bind(PUBLICATION_BASELINE_PATH).all<{ path: string; body_hex: string; state: string }>();
  if (!results) throw new Error("Media reference scan failed.");
  const draft: Record<string, string> = {};
  let published: Record<string, string> | null = null;
  for (const row of results) {
    const source = Buffer.from(row.body_hex, "hex").toString("utf8");
    if (row.state === "published") {
      const value = JSON.parse(source);
      if (value.version !== 1 || !value.sources || Array.isArray(value.sources) || typeof value.sources !== "object" ||
          Object.values(value.sources).some((body) => typeof body !== "string")) throw new Error("Published media baseline is invalid.");
      published = value.sources;
    } else if (isPublicationSource(row.path)) draft[row.path] = source;
  }
  // Do not substitute this worker's compiled baseline for the other environment.
  if (!published) throw new Error("Published media baseline is unavailable.");
  return [{ environment, state: "draft", sources: draft }, { environment, state: "published", sources: published }];
}
