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
    const rank = (x) => (x === "Home" ? 0 : x === "Blog" ? 1 : 2);
    const ra = rank(A);
    const rb = rank(B);
    if (ra !== rb) return ra - rb;
    return A.localeCompare(B);
  });
  return arr;
}

