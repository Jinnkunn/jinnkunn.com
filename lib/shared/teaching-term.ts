export const TEACHING_SEASONS = ["Fall", "Winter", "Summer"] as const;

export function parseTeachingTerm(term: string): { year: string; season: (typeof TEACHING_SEASONS)[number] | "" } | null {
  const match = term.match(/^(\d{4}\/\d{2})(?:\s+(Fall|Winter|Summer)(?:\s+Term)?)?$/i);
  return match ? {
    year: match[1],
    season: TEACHING_SEASONS.find((season) => season.toLowerCase() === (match[2] || "").toLowerCase()) || "",
  } : null;
}

export function rankTeachingTerm(label: string): number {
  const term = parseTeachingTerm(label);
  return term ? Number(term.year.slice(0, 4)) * 3 + (term.season ? TEACHING_SEASONS.indexOf(term.season) : 0) : -1;
}
