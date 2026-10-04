export const TEACHING_SEASONS = ["Fall", "Winter", "Summer"] as const;

export function parseTeachingTerm(term: string) {
  const match = term.match(/^(\d{4}\/\d{2})(?:\s+(Fall|Winter|Summer)(?:\s+Term)?)?$/i);
  return match ? {
    year: match[1],
    season: TEACHING_SEASONS.find((season) => season.toLowerCase() === (match[2] || "").toLowerCase()) || "",
  } : null;
}

export function formatTeachingTerm(year: string, season: string) {
  if (!year) return "";
  return season ? `${year} ${season} Term` : year;
}

export function teachingAcademicYears(currentYear: number, existing = "") {
  const years = Array.from({ length: 32 }, (_, index) => {
    const year = currentYear + 2 - index;
    return `${year}/${String(year + 1).slice(-2)}`;
  });
  return existing && !years.includes(existing) ? [existing, ...years] : years;
}
