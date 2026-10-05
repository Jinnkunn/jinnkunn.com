import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import compiledBaseline from "@/content/generated/publication-baseline.json";
import { getContentStore } from "./content-store-resolver";
import { createD1Executor, type D1DatabaseLike } from "./d1-executor";
import { PUBLICATION_BASELINE_PATH, isPublicationSource, publicationReview, publicationSnapshot } from "../shared/publication-snapshot";

function database() {
  if (process.env.SITE_ADMIN_STORAGE !== "db") return null;
  try { return (getCloudflareContext().env as unknown as { SITE_ADMIN_DB?: D1DatabaseLike }).SITE_ADMIN_DB; }
  catch { return null; }
}

export async function loadPublishedSnapshot() {
  const db = database();
  if (db) {
    let row: { body: string } | null;
    try {
      const result = await createD1Executor(db).execute({ sql: "SELECT body FROM static_shell_overlays WHERE asset_path = ?", args: [PUBLICATION_BASELINE_PATH] });
      row = result.rows[0] as { body: string } || null;
    } catch (error) {
      if (!String(error).includes("no such table")) throw error;
      row = null;
    }
    if (row) {
      const value = JSON.parse(row.body);
      if (value.version !== 1 || !value.sources || typeof value.sources !== "object") throw new Error("Published baseline is invalid.");
      return publicationSnapshot(value.sources);
    }
  }
  return publicationSnapshot(compiledBaseline.sources);
}

export async function loadSavedSnapshot() {
  const db = database();
  const sources: Record<string, string> = {};
  if (db) {
    // One SELECT gives the review a consistent database snapshot.
    const result = await db.prepare("SELECT rel_path, hex(body) AS body_hex FROM content_files").all<{ rel_path: string; body_hex: string }>();
    for (const row of result.results ?? []) if (isPublicationSource(row.rel_path)) sources[row.rel_path] = Buffer.from(row.body_hex, "hex").toString("utf8");
  } else {
    const store = getContentStore();
    const entries = [];
    for (const prefix of ["posts", "pages", "components", "filesystem"]) entries.push(...await store.listFiles(prefix, { recursive: true }));
    for (const relPath of ["home.json", "now.json", "page-tree.json"]) {
      const file = await store.readFile(relPath);
      if (file) sources[relPath] = file.content;
    }
    for (const entry of entries) if (isPublicationSource(entry.relPath)) {
      const file = await store.readFile(entry.relPath);
      if (file) sources[entry.relPath] = file.content;
    }
  }
  return publicationSnapshot(sources);
}

export async function loadPublicationReview() {
  const current = await loadSavedSnapshot();
  const baseline = await loadPublishedSnapshot();
  return publicationReview(current, baseline);
}

export async function loadPublishedSource(relPath: string) {
  if (!isPublicationSource(relPath)) throw new Error("Invalid publication path.");
  const db = database();
  if (db) {
    try {
      // Public feeds need only their own document, not every site's MDX source.
      const result = await createD1Executor(db).execute({
        sql: "SELECT json_extract(body, ?) AS source, json_extract(body, '$.sha') AS snapshot_sha FROM static_shell_overlays WHERE asset_path = ?",
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
  }
  return { source: compiledBaseline.sources[relPath as keyof typeof compiledBaseline.sources] ?? null, snapshotSha: compiledBaseline.sha };
}
