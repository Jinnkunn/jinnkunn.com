import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import compiledBaseline from "@/content/generated/publication-baseline.json";
import compiledIndex from "@/content/generated/search-index.json";
import compiledManifest from "@/content/generated/routes-manifest.json";
import { PUBLICATION_BASELINE_PATH, readPublicationSearch } from "@/lib/shared/publication-snapshot";
import { createD1Executor, type D1DatabaseLike } from "./d1-executor";

export async function loadPublishedSearch(database?: D1DatabaseLike) {
  let db = database;
  if (!db && process.env.SITE_ADMIN_STORAGE === "db") {
    try { db = (getCloudflareContext().env as unknown as { SITE_ADMIN_DB?: D1DatabaseLike }).SITE_ADMIN_DB; }
    catch { throw new Error("Published search database is unavailable."); }
    if (!db) throw new Error("Published search database is unavailable.");
  }
  let snapshot: { sha: string; search?: unknown } | null = null;
  if (db) {
    try {
      // Index and baseline share a row, so requests cannot mix their versions.
      const result = await createD1Executor(db).execute({
        sql: "SELECT json_extract(body, '$.sha') AS sha, json_extract(body, '$.search') AS search FROM static_shell_overlays WHERE asset_path = ?",
        args: [PUBLICATION_BASELINE_PATH],
      });
      const row = result.rows[0] as { sha: string; search: string | null } | undefined;
      if (row) snapshot = { sha: row.sha, search: row.search ? JSON.parse(row.search) : null };
    } catch (error) {
      if (!String(error).includes("no such table")) throw error;
    }
  }
  return readPublicationSearch(snapshot, { baseline: compiledBaseline, index: compiledIndex, manifest: compiledManifest });
}
