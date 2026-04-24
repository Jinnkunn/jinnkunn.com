import "server-only";

import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type { SiteAdminHomeData } from "@/lib/site-admin/api-types";

const HOME_REL_PATH = "content/home.json";

const EMPTY_DATA: SiteAdminHomeData = {
  title: "Hi there!",
  body: "",
};

export function normalizeHomeData(raw: unknown): SiteAdminHomeData {
  if (!raw || typeof raw !== "object") return { ...EMPTY_DATA };
  const r = raw as Record<string, unknown>;
  const data: SiteAdminHomeData = {
    title:
      typeof r.title === "string" && r.title.trim() ? r.title : EMPTY_DATA.title,
    body: typeof r.body === "string" ? r.body : "",
  };
  if (typeof r.profileImageUrl === "string" && r.profileImageUrl.trim()) {
    data.profileImageUrl = r.profileImageUrl;
  }
  if (typeof r.profileImageAlt === "string" && r.profileImageAlt.trim()) {
    data.profileImageAlt = r.profileImageAlt;
  }
  return data;
}

export async function loadSiteAdminHomeData(): Promise<{
  data: SiteAdminHomeData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(HOME_REL_PATH);
  if (!file) {
    return { data: { ...EMPTY_DATA }, sourceVersion: { fileSha: "" } };
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
