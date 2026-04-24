import "server-only";

import {
  emptyWorksData,
  normalizeWorksData,
} from "@/lib/site-admin/works-normalize";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type { SiteAdminWorksData } from "@/lib/site-admin/api-types";

const WORKS_REL_PATH = "content/works.json";

export { normalizeWorksData };

export async function loadSiteAdminWorksData(): Promise<{
  data: SiteAdminWorksData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(WORKS_REL_PATH);
  if (!file) {
    return {
      data: emptyWorksData(),
      sourceVersion: { fileSha: "" },
    };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    parsed = null;
  }
  return {
    data: normalizeWorksData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminWorksData(input: {
  data: SiteAdminWorksData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizeWorksData(input.data);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: WORKS_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/works.json",
  });
  return { fileSha: result.fileSha };
}
