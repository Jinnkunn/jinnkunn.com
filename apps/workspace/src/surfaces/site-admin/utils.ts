import type {
  NavRow,
  OverrideRow,
  PageListRow,
  PostListRow,
  ProtectedRow,
  SiteSettings,
} from "./types";

export function normalizeString(input: unknown): string {
  return String(input ?? "").trim();
}

const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{10}$/;

export function normalizeGoogleAnalyticsIdDraft(input: unknown): string {
  return normalizeString(input).toUpperCase();
}

export function isGoogleAnalyticsIdDraftValid(input: unknown): boolean {
  const value = normalizeGoogleAnalyticsIdDraft(input);
  return !value || GA4_MEASUREMENT_ID_PATTERN.test(value);
}

export function toInteger(input: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function localDateIso(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Decode the JWT payload without verifying the signature — used only to
// surface login + expiry metadata in the UI when the server doesn't
// return them alongside the token. A malformed / non-JWT string just
// returns null so callers can fall back.
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const payloadBase64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const pad = payloadBase64.length % 4;
    const padded = payloadBase64 + (pad ? "=".repeat(4 - pad) : "");
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function toIsoFromEpochSeconds(epochSeconds: unknown): string {
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n * 1000).toISOString();
}

export function defaultSettings(): SiteSettings {
  return {
    rowId: "",
    siteName: "",
    lang: "en",
    seoTitle: "",
    seoDescription: "",
    favicon: "",
    ogImage: "",
    seoPageOverrides: "",
    googleAnalyticsId: "",
    contentGithubUsers: "",
    sitemapExcludes: "",
    sitemapAutoExcludeEnabled: true,
    sitemapAutoExcludeSections: "",
    sitemapAutoExcludeDepthPages: "",
    sitemapAutoExcludeDepthBlog: "",
    sitemapAutoExcludeDepthPublications: "",
    sitemapAutoExcludeDepthTeaching: "",
    rootPageId: "",
    homePageId: "",
  };
}

export function normalizeSettings(input: unknown): SiteSettings {
  const base = defaultSettings();
  if (!input || typeof input !== "object") return base;
  const src = input as Record<string, unknown>;
  return {
    rowId: normalizeString(src.rowId),
    siteName: normalizeString(src.siteName),
    lang: normalizeString(src.lang) || "en",
    seoTitle: normalizeString(src.seoTitle),
    seoDescription: normalizeString(src.seoDescription),
    favicon: normalizeString(src.favicon),
    ogImage: normalizeString(src.ogImage),
    seoPageOverrides: normalizeString(src.seoPageOverrides),
    googleAnalyticsId: normalizeString(src.googleAnalyticsId),
    contentGithubUsers: normalizeString(src.contentGithubUsers),
    sitemapExcludes: normalizeString(src.sitemapExcludes),
    sitemapAutoExcludeEnabled: Boolean(src.sitemapAutoExcludeEnabled ?? true),
    sitemapAutoExcludeSections: normalizeString(src.sitemapAutoExcludeSections),
    sitemapAutoExcludeDepthPages: normalizeString(src.sitemapAutoExcludeDepthPages),
    sitemapAutoExcludeDepthBlog: normalizeString(src.sitemapAutoExcludeDepthBlog),
    sitemapAutoExcludeDepthPublications: normalizeString(
      src.sitemapAutoExcludeDepthPublications,
    ),
    sitemapAutoExcludeDepthTeaching: normalizeString(src.sitemapAutoExcludeDepthTeaching),
    rootPageId: normalizeString(src.rootPageId),
    homePageId: normalizeString(src.homePageId),
  };
}

export function normalizeNavRow(row: unknown): NavRow {
  const src = (row ?? {}) as Record<string, unknown>;
  return {
    rowId: normalizeString(src.rowId),
    label: normalizeString(src.label),
    href: normalizeString(src.href),
    group: normalizeString(src.group) === "top" ? "top" : "more",
    order: toInteger(src.order, 0),
    enabled: Boolean(src.enabled),
  };
}

export function normalizeOverride(row: unknown): OverrideRow {
  const src = (row ?? {}) as Record<string, unknown>;
  const pageId = normalizeString(src.pageId);
  return {
    rowId: normalizeString(src.rowId) || pageId,
    pageId,
    routePath: normalizeString(src.routePath),
    enabled: Boolean(src.enabled),
  };
}

export function normalizeProtected(row: unknown): ProtectedRow {
  const src = (row ?? {}) as Record<string, unknown>;
  const pageId = normalizeString(src.pageId);
  const auth = normalizeString(src.auth) || "password";
  return {
    rowId: normalizeString(src.rowId) || pageId,
    pageId,
    path: normalizeString(src.path),
    mode: normalizeString(src.mode) || "prefix",
    auth: auth === "github" || auth === "public" ? auth : "password",
    password: "",
    enabled: Boolean(src.enabled),
  };
}

const SETTINGS_KEYS: readonly (keyof SiteSettings)[] = [
  "siteName",
  "lang",
  "seoTitle",
  "seoDescription",
  "favicon",
  "ogImage",
  "googleAnalyticsId",
  "contentGithubUsers",
  "seoPageOverrides",
  "sitemapExcludes",
  "sitemapAutoExcludeEnabled",
  "sitemapAutoExcludeSections",
  "sitemapAutoExcludeDepthPages",
  "sitemapAutoExcludeDepthBlog",
  "sitemapAutoExcludeDepthPublications",
  "sitemapAutoExcludeDepthTeaching",
  "rootPageId",
  "homePageId",
];

export function settingsPatch(
  base: SiteSettings,
  draft: SiteSettings,
): Partial<SiteSettings> {
  const patch: Partial<SiteSettings> = {};
  for (const key of SETTINGS_KEYS) {
    if (base[key] !== draft[key]) {
      (patch as Record<string, unknown>)[key] = draft[key];
    }
  }
  return patch;
}

export function applySettingsPatch(
  base: SiteSettings,
  patch: Partial<SiteSettings>,
): SiteSettings {
  return { ...base, ...patch };
}

export function settingsPatchConflictKeys(
  base: SiteSettings,
  latest: SiteSettings,
  patch: Partial<SiteSettings>,
): Array<keyof SiteSettings> {
  return (Object.keys(patch) as Array<keyof SiteSettings>).filter(
    (key) => base[key] !== latest[key],
  );
}

export function navPatch(base: NavRow, draft: NavRow): Partial<NavRow> {
  const patch: Partial<NavRow> = {};
  (["label", "href", "group", "order", "enabled"] as const).forEach((key) => {
    if (base[key] !== draft[key]) {
      (patch as Record<string, unknown>)[key] = draft[key];
    }
  });
  return patch;
}

export function isNavDirty(base: NavRow, draft: NavRow): boolean {
  return Object.keys(navPatch(base, draft)).length > 0;
}

export function isOverrideDirty(base: OverrideRow, draft: OverrideRow): boolean {
  return normalizeString(base.routePath) !== normalizeString(draft.routePath);
}

export function isProtectedDirty(base: ProtectedRow, draft: ProtectedRow): boolean {
  if (normalizeString(base.path) !== normalizeString(draft.path)) return true;
  if (normalizeString(base.auth) !== normalizeString(draft.auth)) return true;
  if (normalizeString(draft.auth) === "password" && normalizeString(draft.password)) {
    return true;
  }
  return false;
}

export function stripTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

export function formatPendingDeploy(source: {
  pendingDeploy?: boolean;
  pendingDeployReason?: string;
}): string {
  if (source.pendingDeploy === true) return "Yes";
  if (source.pendingDeploy === false) return "No";
  const reason = normalizeString(source.pendingDeployReason);
  return reason ? `Unknown (${reason})` : "Unknown";
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Parse one row from `/api/site-admin/posts.posts[]`. Returns null if
 * the row is missing the required slug, otherwise a strongly-typed
 * `PostListRow` with sensible fallbacks for optional fields. Used by
 * the eager-fetch in SiteAdminContent (which feeds the sidebar tree
 * + command palette index) and historically by the now-defunct
 * Posts panel list. */
export function normalizePostListRow(raw: unknown): PostListRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = normalizeString(r.slug);
  if (!slug) return null;
  return {
    slug,
    href: normalizeString(r.href) || `/blog/${slug}`,
    title: normalizeString(r.title) || slug,
    dateIso: (r.dateIso as string | null) ?? null,
    dateText: (r.dateText as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    draft: asBoolean(r.draft),
    tags: Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === "string")
      : [],
    wordCount: asInteger(r.wordCount),
    readingMinutes: asInteger(r.readingMinutes),
    version: normalizeString(r.version),
  };
}

/** Same shape as `normalizePostListRow` but for the pages endpoint. */
export function normalizePageListRow(raw: unknown): PageListRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = normalizeString(r.slug);
  if (!slug) return null;
  return {
    slug,
    href: normalizeString(r.href) || `/pages/${slug}`,
    title: normalizeString(r.title) || slug,
    description: (r.description as string | null) ?? null,
    updatedIso: (r.updatedIso as string | null) ?? null,
    draft: asBoolean(r.draft),
    wordCount: asInteger(r.wordCount),
    readingMinutes: asInteger(r.readingMinutes),
    version: normalizeString(r.version),
  };
}
