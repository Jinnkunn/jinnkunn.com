import "server-only";
import { getDocumentRepository } from "./content-store-resolver";
import { contentInventory } from "../shared/content-inventory";
import { publicationValidation } from "../shared/publication-validation";
import { isPublicationSource, publicationReview, publicationSnapshot } from "../shared/publication-snapshot";
import { describePublicationChange } from "../shared/publication-review-details";
import { ALL_PUBLICATION_SCOPE, publicationCandidate, publicationScopeOptions } from "../shared/publication-scope";
import { loadPublishedSnapshot, publicationStoreContext } from "./active-publication";

export { loadPublishedSnapshot, loadPublishedSource } from "./active-publication";

export async function loadSavedSnapshot(modified: Record<string, number> = {}) {
  const db = publicationStoreContext()?.db;
  const sources: Record<string, string> = {};
  if (db) {
    // One SELECT gives the review a consistent database snapshot.
    const result = await db.prepare("SELECT rel_path, hex(body) AS body_hex, updated_at FROM content_files").all<{ rel_path: string; body_hex: string; updated_at: number }>();
    for (const row of result.results ?? []) if (isPublicationSource(row.rel_path)) {
      sources[row.rel_path] = Buffer.from(row.body_hex, "hex").toString("utf8");
      modified[row.rel_path] = Number(row.updated_at);
    }
  } else {
    const store = getDocumentRepository();
    const entries = [];
    for (const prefix of ["posts", "pages", "components", "filesystem"]) entries.push(...await store.list(prefix, { recursive: true }));
    for (const relPath of ["home.json", "now.json", "page-tree.json"]) {
      const file = await store.readText(relPath);
      if (file) sources[relPath] = file.content;
    }
    for (const entry of entries) if (isPublicationSource(entry.path)) {
      const file = await store.readText(entry.path);
      if (file) sources[entry.path] = file.content;
      if (entry.updatedAt) modified[entry.path] = entry.updatedAt;
    }
  }
  return publicationSnapshot(sources);
}

export async function loadPublicationReview(scope = ALL_PUBLICATION_SCOPE) {
  const modified: Record<string, number> = {};
  const [saved, baseline] = await Promise.all([loadSavedSnapshot(modified), loadPublishedSnapshot()]);
  const current = publicationCandidate(saved, baseline, scope);
  const review = publicationReview(current, baseline);
  const inventory = contentInventory(current.sources, modified);
  return { ...review, scope, availableScopes: publicationScopeOptions(saved, baseline),
    pendingChangeCount: scope === ALL_PUBLICATION_SCOPE ? review.changes.length : publicationReview(saved, baseline).changes.length,
    validation: publicationValidation(current.sources, inventory), inventory, changes: review.changes.map((change) => ({
    ...change,
    title: ({ "home.json": "Home", "now.json": "Now", "page-tree.json": "Page order", "filesystem/announcements.json": "Announcements", "filesystem/site-config.json": "Site settings", "filesystem/protected-routes.json": "Page access" } as Record<string, string>)[change.path] || change.title,
    details: describePublicationChange(change, current, baseline),
  })) };
}
