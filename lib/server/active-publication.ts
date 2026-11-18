import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import compiledBaseline from "@/content/generated/publication-baseline.json";
import { createD1Executor, type D1DatabaseLike } from "./d1-executor";
import { PUBLICATION_BASELINE_PATH, isPublicationSource, publicationSnapshot } from "../shared/publication-snapshot";
import { activeOverlayTable, workerOverlayKey } from "../shared/static-release.ts";

export function publicationStoreContext() {
  if (process.env.SITE_ADMIN_STORAGE !== "db") return null;
  const env = getCloudflareContext().env as unknown as { SITE_ADMIN_DB?: D1DatabaseLike };
  if (!env.SITE_ADMIN_DB) throw new Error("Content database is unavailable.");
  return { db: env.SITE_ADMIN_DB, overlayKey: workerOverlayKey(env) };
}

export async function loadPublishedSnapshot() {
  const context = publicationStoreContext();
  if (context) {
    const { db, overlayKey } = context;
    let row: { body: string } | null;
    try {
      const result = await createD1Executor(db).execute({ sql: `SELECT body FROM ${activeOverlayTable(overlayKey)} WHERE asset_path = ?`, args: [PUBLICATION_BASELINE_PATH] });
      row = result.rows[0] as { body: string } || null;
    } catch (error) {
      if (!String(error).includes("no such table")) throw error;
      row = null;
    }
    if (row) {
      const value = JSON.parse(row.body);
      if (value.version !== 1 || !value.sources || typeof value.sources !== "object") throw new Error("Published baseline is invalid.");
      const verified = publicationSnapshot(value.sources);
      if (verified.sha !== value.sha) throw new Error("Published baseline is invalid.");
      return verified;
    }
    if (overlayKey) throw new Error("Active published baseline is unavailable.");
  }
  return publicationSnapshot(compiledBaseline.sources);
}

export async function loadPublishedSource(relPath: string) {
  if (!isPublicationSource(relPath)) throw new Error("Invalid publication path.");
  const context = publicationStoreContext();
  if (context) {
    const { db, overlayKey } = context;
    try {
      // Public feeds need only their own document, not every site's MDX source.
      const result = await createD1Executor(db).execute({
        sql: `SELECT json_extract(body, ?) AS source, json_extract(body, '$.sha') AS snapshot_sha FROM ${activeOverlayTable(overlayKey)} WHERE asset_path = ?`,
        args: [`$.sources.${JSON.stringify(relPath)}`, PUBLICATION_BASELINE_PATH],
      });
      const row = result.rows[0];
      if (row) {
        if (!/^[a-f0-9]{64}$/.test(String(row.snapshot_sha)) || (row.source !== null && typeof row.source !== "string")) throw new Error("Published baseline is invalid.");
        return { source: row.source as string | null, snapshotSha: String(row.snapshot_sha) };
      }
    } catch (error) {
      if (!String(error).includes("no such table")) throw error;
    }
    if (overlayKey) throw new Error("Active published baseline is unavailable.");
  }
  return { source: compiledBaseline.sources[relPath as keyof typeof compiledBaseline.sources] ?? null, snapshotSha: compiledBaseline.sha };
}
