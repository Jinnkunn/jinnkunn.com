// Picks the correct ContentStore backend based on `SITE_ADMIN_STORAGE`.
// Kept in a separate file so `lib/server/content-store.ts` stays dependency-free
// and doesn't pull in the GitHub client (and node:crypto) when it's not needed.
// No `server-only` marker so node:test can import this module directly.

import { createLocalContentStore, type ContentStore } from "./content-store.ts";
import { createGithubContentStoreFromEnv } from "./github-content-store.ts";

export function getContentStore(): ContentStore {
  const kind = String(process.env.SITE_ADMIN_STORAGE || "local").trim().toLowerCase();
  if (kind === "github") {
    const github = createGithubContentStoreFromEnv();
    if (github) return github;
    // Missing env → fall back to local so dev with partial .env still works.
  }
  return createLocalContentStore();
}
