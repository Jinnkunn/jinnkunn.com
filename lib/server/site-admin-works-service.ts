import "server-only";

import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type {
  SiteAdminWorksData,
  WorksCategory,
  WorksEntryDTO,
} from "@/lib/site-admin/api-types";

const WORKS_REL_PATH = "content/works.json";

const EMPTY_DATA: SiteAdminWorksData = {
  title: "Works",
  entries: [],
};

function coerceCategory(input: unknown): WorksCategory {
  const s = String(input ?? "").toLowerCase();
  return s === "recent" ? "recent" : "passed";
}

function coerceEntries(input: unknown): WorksEntryDTO[] {
  if (!Array.isArray(input)) return [];
  const out: WorksEntryDTO[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const role = typeof r.role === "string" ? r.role : "";
    if (!role.trim()) continue;
    const entry: WorksEntryDTO = {
      category: coerceCategory(r.category),
      role,
      period: typeof r.period === "string" ? r.period : "",
    };
    if (typeof r.affiliation === "string" && r.affiliation.trim()) {
      entry.affiliation = r.affiliation;
    }
    if (typeof r.affiliationUrl === "string" && r.affiliationUrl.trim()) {
      entry.affiliationUrl = r.affiliationUrl;
    }
    if (typeof r.location === "string" && r.location.trim()) {
      entry.location = r.location;
    }
    if (typeof r.description === "string" && r.description.trim()) {
      entry.description = r.description;
    }
    out.push(entry);
  }
  return out;
}

export function normalizeWorksData(raw: unknown): SiteAdminWorksData {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_DATA, entries: [] };
  }
  const r = raw as Record<string, unknown>;
  return {
    title: typeof r.title === "string" && r.title.trim() ? r.title : "Works",
    description: typeof r.description === "string" ? r.description : undefined,
    intro: typeof r.intro === "string" && r.intro.trim() ? r.intro : undefined,
    note: typeof r.note === "string" && r.note.trim() ? r.note : undefined,
    entries: coerceEntries(r.entries),
  };
}

export async function loadSiteAdminWorksData(): Promise<{
  data: SiteAdminWorksData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(WORKS_REL_PATH);
  if (!file) {
    return {
      data: { ...EMPTY_DATA, entries: [] },
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
