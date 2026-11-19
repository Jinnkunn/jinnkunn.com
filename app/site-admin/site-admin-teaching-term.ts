export { TEACHING_SEASONS, parseTeachingTerm } from "../../lib/shared/teaching-term.ts";

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
