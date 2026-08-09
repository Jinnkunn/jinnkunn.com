// Publication label/venue vocabulary shared by the rendered publication list
// and the (non-rendering) MDX PublicationsEntry component. These used to live
// in publication-card.tsx, which emitted the `.pub-card` markup that is on the
// production style regression's forbidden-selector list; the card is gone, the
// classification logic it carried is not.

export type LabelKind = "conference" | "journal" | "arxiv" | "workshop" | "other";

export function classifyLabel(label: string): LabelKind {
  const key = label.toLowerCase().trim();
  if (key === "conference") return "conference";
  if (key === "journal") return "journal";
  if (key === "workshop") return "workshop";
  if (key === "arxiv.org" || key === "arxiv") return "arxiv";
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

/** One-line venue name for a collapsed summary. Falls back to a readable
 * label when the authored text was nothing but a link. */
export function venueSummaryText(venue: { type?: string; text?: string }): string {
  const cleaned = stripVenueBoilerplate(venue.text ?? "");
  if (cleaned) return cleaned;
  if (classifyLabel(venue.type ?? "") === "arxiv") return "arXiv preprint";
  return (venue.text ?? "").trim();
}
