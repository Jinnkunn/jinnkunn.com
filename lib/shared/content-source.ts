export type ContentSourceKind = "filesystem" | "notion";

const CONTENT_SOURCE_KINDS = new Set<ContentSourceKind>(["filesystem", "notion"]);

type SourceEnv = Record<string, string | undefined | null>;

export function normalizeContentSourceKind(value: unknown): ContentSourceKind | "" {
  const kind = String(value ?? "").trim().toLowerCase();
  return CONTENT_SOURCE_KINDS.has(kind as ContentSourceKind)
    ? (kind as ContentSourceKind)
    : "";
}

export function hasConfiguredNotionSource(
  env: SourceEnv = process.env,
): boolean {
  return Boolean(String(env.NOTION_TOKEN ?? "").trim()) &&
    Boolean(String(env.NOTION_SITE_ADMIN_PAGE_ID ?? "").trim());
}

export function resolveContentSourceKind(opts?: {
  env?: SourceEnv;
  fallback?: ContentSourceKind;
}): ContentSourceKind {
  const env = opts?.env ?? process.env;
  const explicit = normalizeContentSourceKind(env.CONTENT_SOURCE);
  if (explicit) return explicit;
  if (hasConfiguredNotionSource(env)) return "notion";
  return normalizeContentSourceKind(opts?.fallback) || "filesystem";
}
