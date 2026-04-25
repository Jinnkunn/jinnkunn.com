import type {
  NavRow,
  OverrideRow,
  ProtectedRow,
  SiteSettings,
} from "./types";

export function normalizeString(input: unknown): string {
  return String(input ?? "").trim();
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
