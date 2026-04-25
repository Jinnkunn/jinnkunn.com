import type {
  SiteAdminWorksData,
  WorksCategory,
  WorksEntryDTO,
} from "./api-types";
import {
  normalizeStructuredPageSections,
  WORKS_SECTIONS,
} from "./page-sections.ts";

const EMPTY_DATA: SiteAdminWorksData = {
  schemaVersion: 2,
  title: "Works",
  sections: WORKS_SECTIONS,
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
    schemaVersion: 2,
    title: typeof r.title === "string" && r.title.trim() ? r.title : "Works",
    description: typeof r.description === "string" ? r.description : undefined,
    sections: normalizeStructuredPageSections(r.sections, WORKS_SECTIONS),
    intro: typeof r.intro === "string" && r.intro.trim() ? r.intro : undefined,
    note: typeof r.note === "string" && r.note.trim() ? r.note : undefined,
    entries: coerceEntries(r.entries),
  };
}

export function emptyWorksData(): SiteAdminWorksData {
  return { ...EMPTY_DATA, entries: [] };
}
