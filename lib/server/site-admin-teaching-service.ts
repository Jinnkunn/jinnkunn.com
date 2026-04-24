import "server-only";

import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type {
  SiteAdminTeachingData,
  TeachingEntryDTO,
  TeachingLinkDTO,
} from "@/lib/site-admin/api-types";

const TEACHING_REL_PATH = "content/teaching.json";

const EMPTY_DATA: SiteAdminTeachingData = {
  title: "Teaching",
  headerLinks: [],
  entries: [],
  footerLinks: [],
};

function coerceLinks(input: unknown): TeachingLinkDTO[] {
  if (!Array.isArray(input)) return [];
  const out: TeachingLinkDTO[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label : "";
    const href = typeof r.href === "string" ? r.href : "";
    if (!label || !href) continue;
    out.push({ label, href });
  }
  return out;
}

function coerceEntries(input: unknown): TeachingEntryDTO[] {
  if (!Array.isArray(input)) return [];
  const out: TeachingEntryDTO[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const term = typeof r.term === "string" ? r.term : "";
    const courseCode = typeof r.courseCode === "string" ? r.courseCode : "";
    if (!term && !courseCode) continue; // must have at least one identifier
    const entry: TeachingEntryDTO = {
      term,
      period: typeof r.period === "string" ? r.period : "",
      role: typeof r.role === "string" ? r.role : "",
      courseCode,
      courseName: typeof r.courseName === "string" ? r.courseName : "",
    };
    if (typeof r.courseUrl === "string" && r.courseUrl.trim()) {
      entry.courseUrl = r.courseUrl;
    }
    if (typeof r.instructor === "string" && r.instructor.trim()) {
      entry.instructor = r.instructor;
    }
    out.push(entry);
  }
  return out;
}

export function normalizeTeachingData(raw: unknown): SiteAdminTeachingData {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_DATA, headerLinks: [], entries: [], footerLinks: [] };
  }
  const r = raw as Record<string, unknown>;
  return {
    title:
      typeof r.title === "string" && r.title.trim() ? r.title : "Teaching",
    description: typeof r.description === "string" ? r.description : undefined,
    intro: typeof r.intro === "string" && r.intro.trim() ? r.intro : undefined,
    headerLinks: coerceLinks(r.headerLinks),
    entries: coerceEntries(r.entries),
    footerLinks: coerceLinks(r.footerLinks),
  };
}

export async function loadSiteAdminTeachingData(): Promise<{
  data: SiteAdminTeachingData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(TEACHING_REL_PATH);
  if (!file) {
    return {
      data: { ...EMPTY_DATA, headerLinks: [], entries: [], footerLinks: [] },
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
