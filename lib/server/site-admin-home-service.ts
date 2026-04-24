import "server-only";

import {
  emptyHomeData,
  normalizeHomeData,
} from "@/lib/site-admin/home-normalize";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type { SiteAdminHomeData } from "@/lib/site-admin/api-types";

const HOME_REL_PATH = "content/home.json";

export { normalizeHomeData };

export async function loadSiteAdminHomeData(): Promise<{
  data: SiteAdminHomeData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(HOME_REL_PATH);
  if (!file) {
    return { data: emptyHomeData(), sourceVersion: { fileSha: "" } };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    parsed = null;
  }
  return {
    data: normalizeHomeData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminHomeData(input: {
  data: SiteAdminHomeData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizeHomeData(input.data);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: HOME_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/home.json",
  });
  return { fileSha: result.fileSha };
}
