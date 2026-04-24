import type {
  SiteAdminTeachingData,
  TeachingEntryDTO,
  TeachingLinkDTO,
} from "./api-types";
import {
  normalizeStructuredPageSections,
  TEACHING_SECTIONS,
} from "./page-sections.ts";

const EMPTY_DATA: SiteAdminTeachingData = {
  schemaVersion: 2,
  title: "Teaching",
  sections: TEACHING_SECTIONS,
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
    schemaVersion: 2,
    title:
      typeof r.title === "string" && r.title.trim() ? r.title : "Teaching",
    description: typeof r.description === "string" ? r.description : undefined,
    sections: normalizeStructuredPageSections(r.sections, TEACHING_SECTIONS),
    intro: typeof r.intro === "string" && r.intro.trim() ? r.intro : undefined,
    headerLinks: coerceLinks(r.headerLinks),
    entries: coerceEntries(r.entries),
    footerLinks: coerceLinks(r.footerLinks),
  };
}

export function emptyTeachingData(): SiteAdminTeachingData {
  return { ...EMPTY_DATA, headerLinks: [], entries: [], footerLinks: [] };
}
