const CONTENT_SOURCE_KINDS = new Set(["filesystem", "notion"]);

export function normalizeContentSourceKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return CONTENT_SOURCE_KINDS.has(kind) ? kind : "";
}

export function hasConfiguredNotionSource(env = process.env) {
  return Boolean(String(env.NOTION_TOKEN || "").trim()) &&
    Boolean(String(env.NOTION_SITE_ADMIN_PAGE_ID || "").trim());
}

export function resolveContentSourceKind(opts = {}) {
  const env = opts.env || process.env;
  const explicit = normalizeContentSourceKind(env.CONTENT_SOURCE);
  if (explicit) return explicit;
  if (hasConfiguredNotionSource(env)) return "notion";
  return normalizeContentSourceKind(opts.fallback) || "filesystem";
}
