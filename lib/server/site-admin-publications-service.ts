import "server-only";

import {
  emptyPublicationsData,
  normalizePublicationsData,
} from "@/lib/site-admin/publications-normalize";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type { SiteAdminPublicationsData } from "@/lib/site-admin/api-types";

const PUBLICATIONS_REL_PATH = "content/publications.json";

export { normalizePublicationsData };

/** Read the current publications data from the site-admin source store,
 * falling back to an empty template if the file is missing. Returns the
 * file sha for optimistic-concurrency checks on write. */
export async function loadSiteAdminPublicationsData(): Promise<{
  data: SiteAdminPublicationsData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(PUBLICATIONS_REL_PATH);
  if (!file) {
    return { data: emptyPublicationsData(), sourceVersion: { fileSha: "" } };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    // Corrupt JSON — surface empty so the UI can recover via save.
    parsed = null;
  }
  return {
    data: normalizePublicationsData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminPublicationsData(input: {
  data: SiteAdminPublicationsData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizePublicationsData(input.data);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: PUBLICATIONS_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/publications.json",
  });
  return { fileSha: result.fileSha };
}
