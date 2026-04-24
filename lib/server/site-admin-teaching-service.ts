import "server-only";

import {
  emptyTeachingData,
  normalizeTeachingData,
} from "@/lib/site-admin/teaching-normalize";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type { SiteAdminTeachingData } from "@/lib/site-admin/api-types";

const TEACHING_REL_PATH = "content/teaching.json";

export { normalizeTeachingData };

export async function loadSiteAdminTeachingData(): Promise<{
  data: SiteAdminTeachingData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(TEACHING_REL_PATH);
  if (!file) {
    return {
      data: emptyTeachingData(),
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
    data: normalizeTeachingData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminTeachingData(input: {
  data: SiteAdminTeachingData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizeTeachingData(input.data);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: TEACHING_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/teaching.json",
  });
  return { fileSha: result.fileSha };
}
