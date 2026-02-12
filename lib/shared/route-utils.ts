// Shared, side-effect-free helpers used by both build scripts (Node) and the
// Next.js runtime.

/** Extract a Notion-like id from an id or URL and return a compact 32-hex form. */
export function compactId(idOrUrl: string): string {
  const s = String(idOrUrl || "").trim();
  const m =
    s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ||
    s.match(/[0-9a-f]{32}/i);
  if (!m) return "";
  return m[0].replace(/-/g, "").toLowerCase();
}

/** Slugify human text into a stable url-ish token. */
export function slugify(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[\'\"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/** Normalize a user-supplied route path (href) into a consistent form. */
export function normalizeRoutePath(p: string): string {
  const raw = String(p || "").trim();
  if (!raw) return "";
  let out = raw.startsWith("/") ? raw : `/${raw}`;
  out = out.replace(/\/+$/g, "");
  return out || "/";
}

/** Convert a compact 32-hex id into dashed UUID form. */
export function dashify32(id32: string): string {
  const s = String(id32 || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) return "";
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
