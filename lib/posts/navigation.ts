type DatedDocument = { href: string; dateIso: string | null };
export function compareBlogDocuments(a: DatedDocument, b: DatedDocument) {
  if (a.dateIso && b.dateIso) return a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0;
  if (a.dateIso && !b.dateIso) return -1;
  if (!a.dateIso && b.dateIso) return 1;
  return a.href.localeCompare(b.href);
}
export function adjacentBlogDocuments<T extends DatedDocument>(items: T[], href: string): { prev: T | null; next: T | null } {
  const sorted = [...items].sort(compareBlogDocuments);
  const index = sorted.findIndex((item) => item.href === href);
  return index < 0 ? { prev: null, next: null } : { prev: sorted[index - 1] || null, next: sorted[index + 1] || null };
}
