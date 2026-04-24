import "server-only";

import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type {
  SiteAdminNewsData,
  NewsEntryDTO,
} from "@/lib/site-admin/api-types";

const NEWS_REL_PATH = "content/news.json";

const EMPTY_DATA: SiteAdminNewsData = {
  title: "News",
  entries: [],
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerceEntries(input: unknown): NewsEntryDTO[] {
  if (!Array.isArray(input)) return [];
  const out: NewsEntryDTO[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const dateIso = typeof r.dateIso === "string" ? r.dateIso : "";
    const body = typeof r.body === "string" ? r.body : "";
    if (!dateIso || !body.trim()) continue;
    out.push({
      dateIso: ISO_RE.test(dateIso) ? dateIso : dateIso.trim(),
      body: body.trim(),
    });
  }
  // Sort newest-first by ISO date string (lexicographic = chronological for YYYY-MM-DD).
  out.sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));
  return out;
}

export function normalizeNewsData(raw: unknown): SiteAdminNewsData {
  if (!raw || typeof raw !== "object") return { ...EMPTY_DATA, entries: [] };
  const r = raw as Record<string, unknown>;
  return {
    title: typeof r.title === "string" && r.title.trim() ? r.title : "News",
    description: typeof r.description === "string" ? r.description : undefined,
    entries: coerceEntries(r.entries),
  };
}

export async function loadSiteAdminNewsData(): Promise<{
  data: SiteAdminNewsData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(NEWS_REL_PATH);
  if (!file) {
    return { data: { ...EMPTY_DATA, entries: [] }, sourceVersion: { fileSha: "" } };
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
