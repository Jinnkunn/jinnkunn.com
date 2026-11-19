import { isDeepStrictEqual } from "node:util";
import matter from "gray-matter";
import { parseJsxAttrs } from "../components/parse.ts";
import { isPublicationSource, publicationSnapshot, type PublicationSnapshot } from "./publication-snapshot.ts";
import { COLLECTION_ENTRY_ID, ENTRY_SCOPED_COLLECTIONS, prepareEntryPublication, type EntryScopedCollection } from "./publication-entry-scope.ts";

export type PublicationScopeOption = { id: string; label: string };
export const ALL_PUBLICATION_SCOPE = "all";
const NEWS = "components/news.mdx";
const ENTRY_LABELS = { teaching: "Teaching", works: "Works", publications: "Publications" };
const EDITORIAL_METADATA = new Set(["title", "description", "date", "updated", "tags", "cover", "ogImage"]);

function collectionScope(scope: string) {
  const colon = scope.indexOf(":");
  const kind = scope.slice(0, colon) as EntryScopedCollection;
  return colon > 0 && ENTRY_SCOPED_COLLECTIONS.includes(kind) ? { kind, id: scope.slice(colon + 1) } : null;
}

export function validPublicationScope(value: unknown): value is string {
  return typeof value === "string" && value.length <= 300 && (value === ALL_PUBLICATION_SCOPE ||
    (value.startsWith("news:") && COLLECTION_ENTRY_ID.test(value.slice(5))) ||
    COLLECTION_ENTRY_ID.test(collectionScope(value)?.id ?? "") ||
    (value.startsWith("document:") && isPublicationSource(value.slice(9))));
}

function scopeError(reason: string): never {
  throw new Error(`PUBLICATION_SCOPE_CHANGED: ${reason} Refresh the review, or review all changes together.`);
}

function readNewsRows(source: string) {
  const body = matter(source, {}).content;
  const offset = source.length - body.length;
  const rows = [...body.matchAll(/<NewsEntry\b([^<>]*)>([\s\S]*?)<\/NewsEntry>/g)].map((match, index) => {
    const attrs = parseJsxAttrs(match[1]);
    const start = offset + match.index;
    return { id: attrs.entryId || `news-${index + 1}`, explicit: Boolean(attrs.entryId), date: attrs.date || "",
      text: match[2].trim(), raw: match[0], start, end: start + match[0].length };
  });
  if (rows.some((row) => !COLLECTION_ENTRY_ID.test(row.id)) || new Set(rows.map((row) => row.id)).size !== rows.length) {
    scopeError("News entries do not have unique identities.");
  }
  return rows;
}

function replaceNewsEntry(before: string, after: string, id: string) {
  const saved = readNewsRows(after);
  // Stabilize identities before inserting ahead of implicit legacy entries.
  // Only ID attributes are added; existing prose, order and dividers stay intact.
  for (const legacy of readNewsRows(before).filter((row) => !row.explicit).reverse()) {
    const start = legacy.start + "<NewsEntry".length;
    before = before.slice(0, start) + ` entryId="${legacy.id}"` + before.slice(start);
  }
  const live = readNewsRows(before);
  const index = saved.findIndex((row) => row.id === id && row.explicit);
  const row = saved[index];
  const previous = live.find((entry) => entry.id === id);
  if (!row || (previous && previous.date === row.date && previous.text === row.text)) {
    scopeError("This News entry has no independent saved update.");
  }
  if (previous) return before.slice(0, previous.start) + row.raw + before.slice(previous.end);
  if (!live.length) scopeError("The initial News collection must be published as a group.");
  // Only insert next to a peer that already exists in Live. Leave draft-only
  // dividers, order changes, removals, and other entries untouched.
  const liveById = new Map(live.map((entry) => [entry.id, entry]));
  const next = saved.slice(index + 1).find((entry) => liveById.has(entry.id));
  const prev = saved.slice(0, index).findLast((entry) => liveById.has(entry.id));
  if (next && prev && live.indexOf(liveById.get(next.id)!) !== live.indexOf(liveById.get(prev.id)!) + 1) {
    scopeError("This News entry depends on a saved ordering change.");
  }
  if (next) {
    const start = liveById.get(next.id)!.start;
    return before.slice(0, start) + row.raw + "\n\n" + before.slice(start);
  }
  if (prev) {
    const end = liveById.get(prev.id)!.end;
    return before.slice(0, end) + "\n\n" + row.raw + before.slice(end);
  }
  scopeError("This News entry has no published neighbor.");
}

function documentEditAllowed(path: string, before: string, after: string) {
  if (path === "home.json" || path === "now.json" || path === "filesystem/announcements.json") return true;
  if (path.startsWith("components/") && path !== NEWS) return true;
  if (!/^(posts|pages)\/.+\.mdx$/.test(path)) return false;
  // Visibility, hierarchy, and unrecognized metadata stay in group review.
  const structuralFields = (value: string) => Object.fromEntries(Object.entries(matter(value, {}).data)
    .filter(([key]) => !EDITORIAL_METADATA.has(key)));
  return isDeepStrictEqual(structuralFields(before), structuralFields(after));
}

function dependsOnUnpublishedDocument(source: string, saved: PublicationSnapshot, live: PublicationSnapshot) {
  return Object.keys(saved.sources).some((path) => {
    if (Object.hasOwn(live.sources, path)) return false;
    const document = /^(posts|pages)\/(.+)\.mdx$/.exec(path);
    if (document) {
      const slug = document[2].split("/").at(-1)!;
      const route = document[1] === "posts" ? `/blog/${document[2]}` : `/${document[2]}`;
      // Conservative, including relative hrefs, Markdown references, and serialized editor JSON.
      return source.includes(route) || new RegExp(`(?:[/=("']|\\b)${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[?#/)'"\\s]|$)`, "i").test(source);
    }
    return path.startsWith("components/") && new RegExp(`<${path[11].toUpperCase()}${path.slice(12, -4)}Block\\b`).test(source);
  });
}

function scopedChange(saved: PublicationSnapshot, live: PublicationSnapshot, scope: string, entries?: ReturnType<typeof prepareEntryPublication>) {
  const isNews = scope.startsWith("news:");
  const collection = collectionScope(scope);
  const path = isNews ? NEWS : collection ? `components/${collection.kind}.mdx` : scope.slice(9);
  const before = live.sources[path], after = saved.sources[path];
  if (before === undefined || after === undefined || before === after) scopeError("This change requires group review or no longer exists.");
  let updated: string;
  let reviewedText: string;
  if (isNews) {
    const id = scope.slice(5);
    updated = replaceNewsEntry(before, after, id);
    reviewedText = readNewsRows(after).find((row) => row.id === id)!.text;
  } else if (collection) {
    try {
      ({ updated, reviewedText } = (entries ?? prepareEntryPublication(collection.kind, before, after)).select(collection.id));
    } catch (error) {
      scopeError(error instanceof Error ? error.message : "The selected entry could not be isolated.");
    }
  } else {
    if (!documentEditAllowed(path, before, after)) scopeError("This change affects site structure.");
    updated = reviewedText = after;
  }
  if (dependsOnUnpublishedDocument(reviewedText, saved, live)) scopeError("This change references unpublished content.");
  return { path, updated };
}

export function publicationCandidate(saved: PublicationSnapshot, live: PublicationSnapshot, scope = ALL_PUBLICATION_SCOPE): PublicationSnapshot {
  if (!validPublicationScope(scope)) scopeError("Invalid publication selection.");
  if (scope === ALL_PUBLICATION_SCOPE) return saved;
  const { path, updated } = scopedChange(saved, live, scope);
  return publicationSnapshot({ ...live.sources, [path]: updated });
}

export function publicationScopeOptions(saved: PublicationSnapshot, live: PublicationSnapshot): PublicationScopeOption[] {
  const scopes: PublicationScopeOption[] = [];
  function offer(id: string, label: string, entries?: ReturnType<typeof prepareEntryPublication>) {
    try { scopedChange(saved, live, id, entries); scopes.push({ id, label }); }
    catch { /* Coupled or unreadable changes stay in all-changes review. */ }
  }
  for (const [path, source] of Object.entries(saved.sources)) {
    if (live.sources[path] === undefined || live.sources[path] === source) continue;
    if (path === NEWS) {
      try {
        for (const row of readNewsRows(source)) if (row.explicit) {
          offer(`news:${row.id}`, `News: ${row.date} · ${row.text.replace(/\s+/g, " ").slice(0, 80) || "Untitled update"}`);
        }
      } catch { /* Report collection problems in all-changes review. */ }
    } else {
      try {
        const title = path.endsWith(".mdx") && !source.trimStart().startsWith("{") ? matter(source, {}).data.title : "";
        offer(`document:${path}`, typeof title === "string" && title.trim() ? title : path);
      } catch { /* An invalid draft remains in group review. */ }
      const kind = ENTRY_SCOPED_COLLECTIONS.find((name) => path === `components/${name}.mdx`);
      if (kind) try {
        const entries = prepareEntryPublication(kind, live.sources[path], source);
        for (const row of entries.entries) offer(`${kind}:${row.id}`, `${ENTRY_LABELS[kind]}: ${row.label || "Untitled entry"}`, entries);
      } catch { /* Custom and legacy collections remain available for group review. */ }
    }
  }
  return scopes;
}
