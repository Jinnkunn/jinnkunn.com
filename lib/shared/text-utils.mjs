export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

export function tokenizeQuery(q, { maxTerms = 6 } = {}) {
  return String(q || "")
    .trim()
    .toLowerCase()
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxTerms);
}

