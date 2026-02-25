// Shared, side-effect-free helpers used by both build scripts (Node) and the
// Next.js runtime. Keep this file ESM and dependency-free.

/**
 * Extract a Notion-like id from an id or URL and return a compact 32-hex form.
 * @param {string} idOrUrl
 * @returns {string}
 */
export function compactId(idOrUrl) {
  const s = String(idOrUrl || "").trim();
  const m =
    s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ||
    s.match(/[0-9a-f]{32}/i);
  if (!m) return "";
  return m[0].replace(/-/g, "").toLowerCase();
}

/**
 * Slugify human text into a stable url-ish token.
 * @param {string} input
 * @returns {string}
 */
export function slugify(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Normalize a user-supplied route path (href) into a consistent form.
 * - ensures leading slash
 * - strips trailing slashes
 * @param {string} p
 * @returns {string}
 */
export function normalizeRoutePath(p) {
  const raw = String(p || "").trim();
  if (!raw) return "";
  let out = raw.startsWith("/") ? raw : `/${raw}`;
  out = out.replace(/\/+$/g, "");
  return out || "/";
}

/**
 * Canonicalize a route path for public-facing URLs.
 * - /blog/list -> /blog
 * - /blog/list/<slug> -> /blog/<slug>
 * - /list -> /blog
 * - /list/<slug> -> /blog/<slug>
 * @param {string} routePath
 * @returns {string}
 */
export function canonicalizeRoutePath(routePath) {
  const normalized = normalizeRoutePath(routePath);
  if (!normalized) return "";
  if (normalized === "/blog/list") return "/blog";
  if (normalized.startsWith("/blog/list/")) return normalized.replace(/^\/blog\/list\//, "/blog/");
  if (normalized === "/list") return "/blog";
  if (normalized.startsWith("/list/")) return normalized.replace(/^\/list\//, "/blog/");
  return normalized;
}

/**
 * Convert a compact 32-hex id into dashed UUID form.
 * @param {string} id32
 * @returns {string}
 */
export function dashify32(id32) {
  const s = String(id32 || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) return "";
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
