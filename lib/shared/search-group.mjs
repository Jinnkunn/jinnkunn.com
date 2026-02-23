/**
 * Shared search grouping utilities (client + server safe).
 */

/**
 * Return a stable group label for a routePath.
 * This must stay in sync with how the UI groups results.
 *
 * @param {string} routePath
 * @returns {string}
 */
export function groupLabelForRoutePath(routePath) {
  const p0 = String(routePath || "/").trim() || "/";
  const p = p0.startsWith("/") ? p0 : `/${p0}`;
  if (p === "/") return "Home";
  if (p === "/blog" || p.startsWith("/blog/")) return "Blog";
  const seg = p.split("/").filter(Boolean)[0] || "";
  if (!seg) return "Home";
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/**
 * Return a stable group label for a search result by kind + route section.
 * Examples:
 * - (page, "/") -> "Pages / Home"
 * - (blog, "/blog/post-a") -> "Blog"
 * - (database, "/teaching/archive") -> "Databases / Teaching"
 *
 * @param {"page"|"blog"|"database"|string} kind
 * @param {string} routePath
 * @returns {string}
 */
export function groupLabelForSearchResult(kind, routePath) {
  const k = String(kind || "page").trim().toLowerCase();
  const section = groupLabelForRoutePath(routePath);
  if (k === "blog") {
    // Keep the main blog section concise.
    if (section === "Blog") return "Blog";
    return `Blog / ${section}`;
  }
  if (k === "database") return `Databases / ${section}`;
  return `Pages / ${section}`;
}

/**
 * Sort group labels in a human-friendly way (Home first, Blog second, then A-Z).
 * @param {string[]} labels
 * @returns {string[]}
 */
export function sortGroupLabels(labels) {
  const arr = Array.isArray(labels) ? labels.slice() : [];
  const key = (s) => String(s || "").trim();
  arr.sort((a, b) => {
    const A = key(a);
    const B = key(b);
    const rank = (x) =>
      x === "Home"
        ? 0
        : x === "Blog"
          ? 1
          : x.startsWith("Pages / Home")
            ? 2
            : x.startsWith("Pages / ")
              ? 3
              : x.startsWith("Blog / ")
                ? 4
                : x.startsWith("Databases / ")
                  ? 5
                  : 6;
    const ra = rank(A);
    const rb = rank(B);
    if (ra !== rb) return ra - rb;
    return A.localeCompare(B);
  });
  return arr;
}
