const FORMAL_TYPES = new Map([
  ["conference", "Conference"],
  ["journal", "Journal"],
  ["workshop", "Workshop"],
]);
const ARXIV_NAME = /^arxiv(?:\.org)?(?:\s+preprint)?$/i;

function classifyLabel(label: string) {
  const key = label.toLowerCase().trim();
  if (FORMAL_TYPES.has(key)) return key;
  if (ARXIV_NAME.test(key)) return "arxiv";
  if (key === "preprint") return "preprint";
  return "other";
}

/** Strip the bits of an authored venue string that only make sense as a link
 * target — bare URLs, trailing `doi:`/`dio:` identifiers, a dangling
 * "Available at:" — so the remainder reads as a venue name. */
export function stripVenueBoilerplate(text: string): string {
  return text
    .replace(/\b(https?:\/\/\S+)/gi, "")
    .replace(/\s*\b(dio|doi)\s*:?\s*10\.[0-9]+\/\S+/gi, "")
    .replace(/\b(dio|doi)\s*:?\s*$/i, "")
    .replace(/\b(available at)\s*:?\s*$/i, "")
    .replace(/[\s.,:;]+$/u, "")
    .replace(/^[\s.,:;]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Search metadata can still match "arXiv preprint" for a link-only venue. */
export function venueSummaryText(venue: { type?: string; text?: string }): string {
  const cleaned = stripVenueBoilerplate(venue.text ?? "");
  if (cleaned) return cleaned;
  if (classifyLabel(venue.type ?? "") === "arxiv") return "arXiv preprint";
  return "";
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function publicationListMetadata({ labels = [], venues = [], venue }: {
  labels?: readonly string[];
  venues?: readonly { type?: string; text?: string }[];
  venue?: string;
}): { typeLabels: string[]; venueLines: string[] } {
  const types = [
    ...labels.map((label) => ({ label: label.trim(), kind: classifyLabel(label) })),
    ...venues.map(({ type = "" }) => ({ label: type, kind: classifyLabel(type) }))
      .filter(({ kind }) => kind !== "other"),
  ];
  const hasFormalType = types.some(({ kind }) => FORMAL_TYPES.has(kind));
  const typeLabels = uniqueText(types.flatMap(({ label, kind }) => {
    if (kind === "arxiv" || kind === "preprint") {
      return hasFormalType ? [] : ["Preprint"];
    }
    return [FORMAL_TYPES.get(kind) ?? label];
  }));

  const visibleVenue = (text: string) => {
    const cleaned = stripVenueBoilerplate(text);
    return ARXIV_NAME.test(cleaned) || /^preprint$/i.test(cleaned) ? "" : cleaned;
  };
  const venueLines = uniqueText(venues.map(({ text = "" }) => visibleVenue(text)));
  if (!venueLines.length && venue) {
    const fallback = visibleVenue(venue);
    if (fallback) venueLines.push(fallback);
  }
  return { typeLabels, venueLines };
}
