import "server-only";

import {
  emptyNewsData,
  normalizeNewsData,
} from "@/lib/site-admin/news-normalize";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type { SiteAdminNewsData } from "@/lib/site-admin/api-types";

const NEWS_REL_PATH = "content/news.json";

export { normalizeNewsData };

export async function loadSiteAdminNewsData(): Promise<{
  data: SiteAdminNewsData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(NEWS_REL_PATH);
  if (!file) {
    return { data: emptyNewsData(), sourceVersion: { fileSha: "" } };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    parsed = null;
  }
  return {
    data: normalizeNewsData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminNewsData(input: {
  data: SiteAdminNewsData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizeNewsData(input.data);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: NEWS_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/news.json",
  });
  return { fileSha: result.fileSha };
}
