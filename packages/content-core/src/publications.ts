export type PublicationStructuredItem = {
  title: string;
  year: string;
  url: string;
  labels: string[];
};

export type PublicationAuthor = {
  name: string;
  isSelf: boolean;
};

export type PublicationVenue = {
  type: string;
  text: string;
  url?: string;
};

export type PublicationStructuredEntry = PublicationStructuredItem & {
  entryId?: string;
  authors?: string[];
  authorsRich?: PublicationAuthor[];
  externalUrls?: string[];
  doiUrl?: string;
  arxivUrl?: string;
  venue?: string;
  venues?: PublicationVenue[];
  highlights?: string[];
};

type PublicationResources = {
  url?: string;
  doiUrl?: string;
  arxivUrl?: string;
  externalUrls?: string[];
  venues?: { url?: string; text?: string }[];
};

function venueLinks(venues: PublicationResources["venues"]): string[] {
  return (venues ?? []).flatMap((venue) => [
    venue.url,
    ...(venue.text?.match(/https?:\/\/[^\s<>"']+/gi) ?? [])
      .map((url) => url.replace(/[.,;]+$/u, "")),
  ]).filter((url): url is string => Boolean(url));
}

export function publicationLinks(entry: PublicationResources): { href: string; label: string }[] {
  const seen = new Set<string>();
  const links: { href: string; label: string }[] = [];
  for (const candidate of [entry.doiUrl, entry.arxivUrl, entry.url, ...(entry.externalUrls || []), ...venueLinks(entry.venues)]) {
    if (!candidate) continue;
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
    const key = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const host = url.hostname.replace(/^www\./, "");
    const label = host === "doi.org" ? "DOI" : host === "arxiv.org" ? "arXiv" : ["github.com", "gitlab.com"].includes(host) ? "Code" : "Paper";
    links.push({ href: url.href, label });
  }
  return links;
}

const ENTRY_ID = /^[a-z0-9][a-z0-9._:-]{0,95}$/i;
const ANCHOR_PREFIX = "paper-";

function storedId(entry: PublicationStructuredEntry): string {
  const id = typeof entry.entryId === "string" ? entry.entryId.trim() : "";
  return ENTRY_ID.test(id) ? id : "";
}

function legacyId(entry: PublicationStructuredEntry): string {
  const links = publicationLinks(entry);
  const reference = links.find((link) => link.label === "DOI") ?? links.find((link) => link.label !== "Code");
  const url = reference ? new URL(reference.href) : null;
  const key = (url
    ? `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${reference?.label === "Paper" ? url.search : ""}`
    : `${entry.title ?? ""} ${entry.year ?? ""}`
  ).normalize("NFKC").trim().toLowerCase();
  const slug = key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "entry";
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return `legacy-${slug}-${(hash >>> 0).toString(36)}`;
}

export type IdentifiedPublication = PublicationStructuredEntry & { entryId: string };

export function identifyPublications(entries: PublicationStructuredEntry[]): IdentifiedPublication[] {
  const reserved = new Set(entries.map(storedId).filter(Boolean));
  const used = new Set<string>();
  return entries.map((entry) => {
    const saved = storedId(entry);
    let id = saved;
    if (!id || used.has(id)) {
      const base = legacyId(entry);
      id = base;
      for (let suffix = 2; used.has(id) || reserved.has(id); suffix++) id = `${base}-${suffix}`;
    }
    used.add(id);
    return { ...entry, entryId: id };
  });
}

export function publicationAnchorId(entryId: string): string {
  return `${ANCHOR_PREFIX}${entryId}`;
}

export function isPublicationAnchor(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ANCHOR_PREFIX) && ENTRY_ID.test(value.slice(ANCHOR_PREFIX.length));
}

export type PublicationsDocument = {
  version: 1;
  kind: "publications";
  frontmatter: string;
  entries: IdentifiedPublication[];
};

const DEFAULT_FRONTMATTER = '---\ntitle: "Publications"\n---';
const LEGACY_ENTRY = /<PublicationsEntry\s+data\s*=\s*(?:'([^']*)'|"([^"]*)")\s*\/>/g;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parsePublicationEntryData(raw: string | undefined): PublicationStructuredEntry | null {
  if (!raw) return null;
  try {
    const entry: unknown = JSON.parse(raw);
    const text = (value: unknown) => typeof value === "string";
    const rows = (value: unknown, predicate: (item: unknown) => boolean) => value === undefined || (Array.isArray(value) && value.every(predicate));
    if (!record(entry) || typeof entry.title !== "string" || typeof entry.year !== "string" ||
      !["url", "doiUrl", "arxivUrl", "venue", "entryId"].every((key) => entry[key] === undefined || text(entry[key])) ||
      !["labels", "authors", "externalUrls", "highlights"].every((key) => rows(entry[key], text)) ||
      !rows(entry.authorsRich, (author) => record(author) && text(author.name) && typeof author.isSelf === "boolean") ||
      !rows(entry.venues, (venue) => record(venue) && text(venue.type) && text(venue.text) && (venue.url === undefined || text(venue.url)))) return null;
    return { url: "", labels: [], ...entry, title: entry.title, year: entry.year } as PublicationStructuredEntry;
  } catch { return null; }
}

export function isPublicationsJson(source: string) {
  return source.trimStart().startsWith("{");
}

function decodeAttribute(attr: string) {
  return attr.replace(/&(quot|lt|gt|amp|apos|#39);/g, (entity) => ({ "&quot;": '"', "&lt;": "<", "&gt;": ">", "&amp;": "&", "&apos;": "'", "&#39;": "'" })[entity] || entity);
}

export function readPublicationsDocument(source: string, { strict = false } = {}): PublicationsDocument {
  if (isPublicationsJson(source)) {
    const doc: unknown = JSON.parse(source);
    if (!record(doc) || doc.kind !== "publications" || doc.version !== 1 || typeof doc.frontmatter !== "string" ||
        FRONTMATTER.exec(doc.frontmatter)?.[0].trimEnd() !== doc.frontmatter.trimEnd() || !Array.isArray(doc.entries)) {
      throw new Error("Unsupported Publications document format.");
    }
    const entries = doc.entries.map((entry) => parsePublicationEntryData(JSON.stringify(entry)));
    const ids = new Set(entries.map((entry) => entry && storedId(entry)));
    if (entries.some((entry) => !entry || !storedId(entry)) || ids.size !== entries.length) {
      throw new Error("Publications must have valid fields and unique entry IDs.");
    }
    return { version: 1, kind: "publications", frontmatter: doc.frontmatter, entries: entries as IdentifiedPublication[] };
  }
  const header = FRONTMATTER.exec(source)?.[0] || "";
  const body = source.slice(header.length);
  const entries: PublicationStructuredEntry[] = [];
  const residual = body.replace(LEGACY_ENTRY, (_whole, single, double) => {
    const entry = parsePublicationEntryData(decodeAttribute(single ?? double));
    if (!entry && strict) throw new Error("A legacy publication could not be read; repair its source before migrating.");
    if (entry) entries.push(entry);
    return "";
  });
  // Do not silently discard authored prose or custom JSX during migration.
  if (strict && residual.trim()) throw new Error("The legacy collection contains custom source that cannot be migrated automatically.");
  return { version: 1, kind: "publications", frontmatter: header.trimEnd() || DEFAULT_FRONTMATTER, entries: identifyPublications(entries) };
}

export function publicationEntryProblems(entry: PublicationStructuredEntry) {
  const issues: { field: string; message: string }[] = [];
  if (!entry.title.trim()) issues.push({ field: "title", message: "Add a title." });
  if (!entry.year.trim()) issues.push({ field: "year", message: "Add a year or year group." });
  const fields = [["url", entry.url], ["doiUrl", entry.doiUrl], ["arxivUrl", entry.arxivUrl],
    ...(entry.externalUrls || []).map((url) => ["externalUrls", url]), ...(entry.venues || []).map((venue) => ["venues", venue.url])];
  for (const [field, value] of fields) {
    if (!value?.trim()) continue;
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
    } catch { issues.push({ field: String(field), message: "Enter a valid HTTP or HTTPS URL." }); }
  }
  return issues;
}

export function writePublicationsDocument(source: string): string {
  return `${JSON.stringify(readPublicationsDocument(source, { strict: true }), null, 2)}\n`;
}

// Existing clients keep their source editor; this projection is never stored.
export function legacyPublicationsSource(doc: PublicationsDocument): string {
  const body = doc.entries.map((entry) => `<PublicationsEntry data='${JSON.stringify(entry)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "\\u0027")}' />`).join("\n\n");
  return [doc.frontmatter, "", body, ""].join("\n");
}
