import type { NewsEntryDTO, SiteAdminNewsData } from "./api-types";

const EMPTY_DATA: SiteAdminNewsData = {
  schemaVersion: 1,
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
    schemaVersion: 1,
    title: typeof r.title === "string" && r.title.trim() ? r.title : "News",
    description: typeof r.description === "string" ? r.description : undefined,
    entries: coerceEntries(r.entries),
  };
}

export function emptyNewsData(): SiteAdminNewsData {
  return { ...EMPTY_DATA, entries: [] };
}
