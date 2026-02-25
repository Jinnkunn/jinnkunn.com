export function compactId(idOrUrl: string): string {
  const s = String(idOrUrl || "").trim();
  const m =
    s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ||
    s.match(/[0-9a-f]{32}/i);
  if (!m) return "";
  return m[0].replace(/-/g, "").toLowerCase();
}

export function slugify(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export function normalizeRoutePath(p: string): string {
  const raw = String(p || "").trim();
  if (!raw) return "";
  let out = raw.startsWith("/") ? raw : `/${raw}`;
  out = out.replace(/\/+$/g, "");
  return out || "/";
}

export function canonicalizeRoutePath(routePath: string): string {
  const normalized = normalizeRoutePath(routePath);
  if (!normalized) return "";
  if (normalized === "/blog/list") return "/blog";
  if (normalized.startsWith("/blog/list/")) return normalized.replace(/^\/blog\/list\//, "/blog/");
  if (normalized === "/list") return "/blog";
  if (normalized.startsWith("/list/")) return normalized.replace(/^\/list\//, "/blog/");
  return normalized;
}

export function dashify32(id32: string): string {
  const s = String(id32 || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) return "";
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
