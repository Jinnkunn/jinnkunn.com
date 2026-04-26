// Persistent redirect map for renamed pages and posts. Lives at
// `content/redirects.json` so it ships with the rest of the content
// repo and is read by next.config.mjs at build time to emit proper
// 308 redirects (`/old-slug` → `/new-slug`).
//
// Schema:
//   {
//     "pages": { "<oldSlug>": "<newSlug>" },
//     "posts": { "<oldSlug>": "<newSlug>" }
//   }
//
// On every successful movePage / movePost, we call appendRedirect to
// append a fresh entry. We also rewrite any existing entry whose
// destination matches the from-slug so multi-hop renames don't form
// chains: A → B → C becomes A → C and B → C, never A → B → C.

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  type ContentStore,
} from "@/lib/server/content-store";
import { getContentStore } from "@/lib/server/content-store-resolver";
import {
  buildNextRedirects,
  emptyRedirectsTable,
  normalizeRedirectsTable,
  type RedirectKind,
  type RedirectsTable,
} from "./redirects-shape";

export {
  buildNextRedirects,
  emptyRedirectsTable,
  normalizeRedirectsTable,
  type RedirectKind,
  type RedirectsTable,
};

const REDIRECTS_REL = "redirects.json";

async function readRedirectsFile(
  store: ContentStore,
): Promise<{ table: RedirectsTable; sha: string | null }> {
  const file = await store.readFile(REDIRECTS_REL);
  if (!file) return { table: emptyRedirectsTable(), sha: null };
  try {
    return {
      table: normalizeRedirectsTable(JSON.parse(file.content)),
      sha: file.sha,
    };
  } catch {
    // Corrupt JSON — start fresh but keep the existing sha so the next
    // write replaces it cleanly.
    return { table: emptyRedirectsTable(), sha: file.sha };
  }
}

export async function readRedirects(): Promise<RedirectsTable> {
  const store = await getContentStore();
  const { table } = await readRedirectsFile(store);
  return table;
}

/** Drop a single redirect entry. Used by the admin UI when the user
 * wants to forget an old slug (after enough time, or if the redirect
 * was created in error). Idempotent — a missing entry is a no-op. */
export async function deleteRedirect(
  kind: RedirectKind,
  fromSlug: string,
): Promise<void> {
  if (!fromSlug) return;
  const store = await getContentStore();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { table, sha } = await readRedirectsFile(store);
    if (!table[kind][fromSlug]) return; // nothing to do
    delete table[kind][fromSlug];
    const next = JSON.stringify(
      {
        pages: sortedRecord(table.pages),
        posts: sortedRecord(table.posts),
      },
      null,
      2,
    );
    try {
      await store.writeFile(REDIRECTS_REL, `${next}\n`, { ifMatch: sha });
      return;
    } catch (err) {
      if (err instanceof ContentStoreConflictError && attempt === 0) {
        continue;
      }
      throw err;
    }
  }
}

/** Append a single (fromSlug → toSlug) entry. Idempotent — overwrites
 * any prior entry for the same fromSlug. Also collapses chains: any
 * existing entry that pointed at fromSlug is rewritten to point at
 * toSlug. Falls through silently when fromSlug === toSlug. */
export async function appendRedirect(
  kind: RedirectKind,
  fromSlug: string,
  toSlug: string,
): Promise<void> {
  if (!fromSlug || !toSlug || fromSlug === toSlug) return;
  const store = await getContentStore();
  // Optimistic concurrency: read, mutate, write with ifMatch. Retry
  // once on conflict (rare — only happens when a parallel rename runs).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { table, sha } = await readRedirectsFile(store);
    const sub = table[kind];
    sub[fromSlug] = toSlug;
    // Collapse chains: anyone aimed at the old slug now hops directly
    // to the new one. Also drop any self-redirect that emerges.
    for (const [from, to] of Object.entries(sub)) {
      if (to === fromSlug) sub[from] = toSlug;
      if (sub[from] === from) delete sub[from];
    }
    // Don't redirect a slug to itself or to a slug that points back.
    if (sub[toSlug] === fromSlug) delete sub[toSlug];
    const next = JSON.stringify(
      {
        pages: sortedRecord(table.pages),
        posts: sortedRecord(table.posts),
      },
      null,
      2,
    );
    try {
      await store.writeFile(REDIRECTS_REL, `${next}\n`, { ifMatch: sha });
      return;
    } catch (err) {
      if (err instanceof ContentStoreConflictError && attempt === 0) {
        continue;
      }
      // Not-found on a fresh repo — first write needs ifMatch: null.
      if (err instanceof ContentStoreNotFoundError && attempt === 0) {
        await store.writeFile(REDIRECTS_REL, `${next}\n`, { ifMatch: null });
        return;
      }
      throw err;
    }
  }
}

function sortedRecord(obj: Record<string, string>): Record<string, string> {
  const keys = Object.keys(obj).sort();
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

