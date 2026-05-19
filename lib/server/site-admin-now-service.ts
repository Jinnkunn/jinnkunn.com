import "server-only";

import type { SiteAdminNowData } from "@/lib/site-admin/api-types";
import {
  emptyNowData,
  normalizeNowData,
} from "@/lib/site-admin/now-normalize";
import {
  createNowData,
  deleteNowHistoryData,
  updateNowHistoryData,
} from "@/lib/site-admin/now-commands";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";

const NOW_REL_PATH = "content/now.json";

export { normalizeNowData };

type OptionalTextPatch = {
  hasValue: boolean;
  value?: string;
};

export async function loadSiteAdminNowData(): Promise<{
  data: SiteAdminNowData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(NOW_REL_PATH);
  if (!file) {
    return { data: emptyNowData(), sourceVersion: { fileSha: "" } };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    parsed = null;
  }
  return {
    data: normalizeNowData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminNowData(input: {
  data: SiteAdminNowData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizeNowData(input.data);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: NOW_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/now.json",
  });
  return { fileSha: result.fileSha };
}

export async function appendSiteAdminNowUpdate(input: {
  text: string;
  context: OptionalTextPatch;
  location: OptionalTextPatch;
  expectedFileSha?: string;
  date?: string;
  now?: Date;
}): Promise<{
  data: SiteAdminNowData;
  sourceVersion: { fileSha: string };
}> {
  const current = await loadSiteAdminNowData();
  const nextData = createNowData({
    data: current.data,
    text: input.text,
    context: input.context,
    location: input.location,
    date: input.date,
    now: input.now,
  });
  const sourceVersion = await saveSiteAdminNowData({
    data: nextData,
    expectedFileSha: input.expectedFileSha,
  });
  return { data: nextData, sourceVersion };
}

export async function updateSiteAdminNowHistory(input: {
  id: string;
  text: string;
  date?: string;
  expectedFileSha?: string;
  now?: Date;
}): Promise<{
  data: SiteAdminNowData;
  sourceVersion: { fileSha: string };
}> {
  const current = await loadSiteAdminNowData();
  const nextData = updateNowHistoryData({
    data: current.data,
    id: input.id,
    text: input.text,
    date: input.date,
    now: input.now,
  });
  const sourceVersion = await saveSiteAdminNowData({
    data: nextData,
    expectedFileSha: input.expectedFileSha,
  });
  return { data: nextData, sourceVersion };
}

export async function deleteSiteAdminNowHistory(input: {
  id: string;
  expectedFileSha?: string;
}): Promise<{
  data: SiteAdminNowData;
  sourceVersion: { fileSha: string };
}> {
  const current = await loadSiteAdminNowData();
  const nextData = deleteNowHistoryData({
    data: current.data,
    id: input.id,
  });
  const sourceVersion = await saveSiteAdminNowData({
    data: nextData,
    expectedFileSha: input.expectedFileSha,
  });
  return { data: nextData, sourceVersion };
}
