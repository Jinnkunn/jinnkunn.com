export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

export function tokenizeQuery(q: unknown, opts: { maxTerms?: number } = {}): string[] {
  const maxTerms = Number.isFinite(opts.maxTerms) ? Number(opts.maxTerms) : 6;
  return String(q || "")
    .trim()
    .toLowerCase()
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxTerms);
}
