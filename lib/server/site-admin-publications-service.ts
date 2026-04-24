import "server-only";

import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type {
  SiteAdminPublicationsData,
  PublicationProfileLinkDTO,
  PublicationEntryDTO,
} from "@/lib/site-admin/api-types";

const PUBLICATIONS_REL_PATH = "content/publications.json";

const EMPTY_DATA: SiteAdminPublicationsData = {
  title: "Publications",
  profileLinks: [],
  entries: [],
};

function coerceProfileLinks(input: unknown): PublicationProfileLinkDTO[] {
  if (!Array.isArray(input)) return [];
  const out: PublicationProfileLinkDTO[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label : "";
    const href = typeof r.href === "string" ? r.href : "";
    if (!label || !href) continue;
    out.push({
      label,
      href,
      hostname: typeof r.hostname === "string" ? r.hostname : undefined,
    });
  }
  return out;
}

function coerceEntries(input: unknown): PublicationEntryDTO[] {
  if (!Array.isArray(input)) return [];
  const out: PublicationEntryDTO[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title : "";
    if (!title) continue;
    const entry: PublicationEntryDTO = {
      title,
      year: typeof r.year === "string" ? r.year : "",
      url: typeof r.url === "string" ? r.url : "",
      labels: Array.isArray(r.labels)
        ? r.labels.filter((s): s is string => typeof s === "string")
        : [],
    };
    if (Array.isArray(r.authors)) {
      entry.authors = r.authors.filter((s): s is string => typeof s === "string");
    }
    if (Array.isArray(r.authorsRich)) {
      entry.authorsRich = r.authorsRich
        .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
        .map((v) => ({
          name: typeof v.name === "string" ? v.name : "",
          isSelf: v.isSelf === true,
        }))
        .filter((a) => a.name);
    }
    if (Array.isArray(r.externalUrls)) {
      entry.externalUrls = r.externalUrls.filter(
        (s): s is string => typeof s === "string",
      );
    }
    if (typeof r.doiUrl === "string") entry.doiUrl = r.doiUrl;
    if (typeof r.arxivUrl === "string") entry.arxivUrl = r.arxivUrl;
    if (typeof r.venue === "string") entry.venue = r.venue;
    if (Array.isArray(r.venues)) {
      entry.venues = r.venues
        .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
        .map((v) => ({
          type: typeof v.type === "string" ? v.type : "",
          text: typeof v.text === "string" ? v.text : "",
          url: typeof v.url === "string" ? v.url : undefined,
        }));
    }
    if (Array.isArray(r.highlights)) {
      entry.highlights = r.highlights.filter(
        (s): s is string => typeof s === "string",
      );
    }
    out.push(entry);
  }
  return out;
}

export function normalizePublicationsData(raw: unknown): SiteAdminPublicationsData {
  if (!raw || typeof raw !== "object") return { ...EMPTY_DATA };
  const r = raw as Record<string, unknown>;
  return {
    title: typeof r.title === "string" && r.title.trim() ? r.title : "Publications",
    description: typeof r.description === "string" ? r.description : undefined,
    profileLinks: coerceProfileLinks(r.profileLinks),
    entries: coerceEntries(r.entries),
  };
}

/** Read the current publications data from the site-admin source store,
 * falling back to an empty template if the file is missing. Returns the
 * file sha for optimistic-concurrency checks on write. */
export async function loadSiteAdminPublicationsData(): Promise<{
  data: SiteAdminPublicationsData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(PUBLICATIONS_REL_PATH);
  if (!file) {
    return { data: { ...EMPTY_DATA }, sourceVersion: { fileSha: "" } };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    // Corrupt JSON — surface empty so the UI can recover via save.
    parsed = null;
  }
  return {
    data: normalizePublicationsData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminPublicationsData(input: {
  data: SiteAdminPublicationsData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizePublicationsData(input.data);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: PUBLICATIONS_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/publications.json",
  });
  return { fileSha: result.fileSha };
}
