import filesystemSiteConfig from "@/content/filesystem/site-config.json";
import generatedSiteConfig from "@/content/generated/site-config.json";
import { readContentJson } from "@/lib/server/content-json";
import { DEFAULT_SITE_CONFIG } from "@/lib/shared/default-site-config";
import { normalizeGoogleAnalyticsId } from "@/lib/shared/google-analytics";
import { normalizeGithubUserList } from "@/lib/shared/github-users";
import {
  type SitemapAutoExcludeConfig,
  normalizeSitemapAutoExclude,
} from "@/lib/shared/sitemap-policy";
import {
  type SeoPageOverride,
  normalizeSeoPageOverrides,
} from "@/lib/shared/seo-page-overrides";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import { parseSitemapExcludeEntries } from "@/lib/shared/sitemap-excludes";

export type NavItem = {
  href: string;
  label: string;
};

export type SiteConfig = {
  siteName: string; // Used in the navbar logo text.
  lang: string; // HTML <html lang="">
  seo: {
    title: string;
    description: string;
    favicon: string; // Path under /public (e.g. "/assets/favicon.png")
    ogImage?: string; // OpenGraph/Twitter share image path or absolute URL.
    pageOverrides?: Record<string, SeoPageOverride>;
  };
  integrations?: {
    googleAnalyticsId?: string; // GA4 measurement ID (e.g. "G-XXXXXXX")
  };
  security?: {
    contentGithubUsers?: string[];
  };
  appearance: {
    monochrome: {
      enabled: boolean;
      scope: "home" | "all-public";
      desaturateMedia: boolean;
      startsAt: string;
      endsAt: string;
    };
  };
  nav: {
    top: NavItem[];
    more: NavItem[];
  };
  content?: {
    rootPageId?: string | null;
    homePageId?: string | null;
    routeOverrides?: Record<string, string> | null;
    sitemapExcludes?: string[];
    sitemapAutoExclude?: SitemapAutoExcludeConfig;
  };
};

const DEFAULT_CONFIG: SiteConfig = DEFAULT_SITE_CONFIG;

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function asString(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() ? x : undefined;
}

function asOptionalText(x: unknown): string | undefined {
  return typeof x === "string" ? x.trim() : undefined;
}

function asNullableString(x: unknown): string | null | undefined {
  if (x === null) return null;
  return asString(x);
}

function asBoolean(x: unknown): boolean | undefined {
  return typeof x === "boolean" ? x : undefined;
}

function asPublicScope(x: unknown): "home" | "all-public" | undefined {
  return x === "home" || x === "all-public" ? x : undefined;
}

function asRouteOverrides(x: unknown): Record<string, string> | null | undefined {
  if (x === null) return null;
  if (!isObject(x)) return undefined;

  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(x)) {
    const pageId = compactId(rawKey) || String(rawKey || "").trim();
    if (!pageId) continue;
    const routePath = normalizeRoutePath(String(rawValue || ""));
    if (!routePath) continue;
    out[pageId] = routePath;
  }

  return out;
}

function asSitemapExcludes(x: unknown): string[] | undefined {
  const out = parseSitemapExcludeEntries(x);
  return out.length ? out : undefined;
}

function asSitemapAutoExclude(x: unknown): SitemapAutoExcludeConfig {
  return normalizeSitemapAutoExclude(x);
}

function asNavItems(x: unknown): NavItem[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: NavItem[] = [];
  for (const it of x) {
    if (!isObject(it)) continue;
    if (it.enabled === false) continue;
    const href = asString(it.href);
    const label = asString(it.label);
    if (!href || !label) continue;
    out.push({ href, label });
  }
  return out.length ? out : undefined;
}

function normalizeConfig(input: unknown): SiteConfig {
  if (!isObject(input)) return DEFAULT_CONFIG;

  const cfg: SiteConfig = structuredClone(DEFAULT_CONFIG);
  cfg.appearance = cfg.appearance ?? structuredClone(DEFAULT_SITE_CONFIG.appearance);

  cfg.siteName = asString(input.siteName) ?? cfg.siteName;
  cfg.lang = asString(input.lang) ?? cfg.lang;

  if (isObject(input.seo)) {
    cfg.seo.title = asString(input.seo.title) ?? cfg.seo.title;
    cfg.seo.description =
      asString(input.seo.description) ?? cfg.seo.description;
    cfg.seo.favicon = asString(input.seo.favicon) ?? cfg.seo.favicon;
    cfg.seo.ogImage = asString(input.seo.ogImage) ?? cfg.seo.ogImage;
    cfg.seo.pageOverrides = normalizeSeoPageOverrides(input.seo.pageOverrides);
  }

  if (isObject(input.integrations)) {
    cfg.integrations = cfg.integrations ?? {};
    const googleAnalyticsId = normalizeGoogleAnalyticsId(
      input.integrations.googleAnalyticsId,
    );
    if (googleAnalyticsId !== null) {
      cfg.integrations.googleAnalyticsId = googleAnalyticsId;
    }
  }

  if (isObject(input.security)) {
    cfg.security = cfg.security ?? { contentGithubUsers: [] };
    cfg.security.contentGithubUsers = normalizeGithubUserList(input.security.contentGithubUsers);
  }

  if (isObject(input.appearance) && isObject(input.appearance.monochrome)) {
    const monochrome = input.appearance.monochrome;
    cfg.appearance.monochrome.enabled =
      asBoolean(monochrome.enabled) ?? cfg.appearance.monochrome.enabled;
    cfg.appearance.monochrome.scope =
      asPublicScope(monochrome.scope) ?? cfg.appearance.monochrome.scope;
    cfg.appearance.monochrome.desaturateMedia =
      asBoolean(monochrome.desaturateMedia) ?? cfg.appearance.monochrome.desaturateMedia;
    cfg.appearance.monochrome.startsAt =
      asOptionalText(monochrome.startsAt) ?? cfg.appearance.monochrome.startsAt;
    cfg.appearance.monochrome.endsAt =
      asOptionalText(monochrome.endsAt) ?? cfg.appearance.monochrome.endsAt;
  } else if (isObject(input.memorial)) {
    // One-time data migration for existing D1 rows. The old content fields are
    // intentionally ignored; only their appearance state survives until the
    // next settings save writes the new `appearance.monochrome` object.
    cfg.appearance.monochrome.enabled =
      asBoolean(input.memorial.enabled) ?? cfg.appearance.monochrome.enabled;
    cfg.appearance.monochrome.scope =
      asPublicScope(input.memorial.scope) ?? cfg.appearance.monochrome.scope;
    cfg.appearance.monochrome.startsAt =
      asOptionalText(input.memorial.startsAt) ?? cfg.appearance.monochrome.startsAt;
    cfg.appearance.monochrome.endsAt =
      asOptionalText(input.memorial.endsAt) ?? cfg.appearance.monochrome.endsAt;
  }

  if (isObject(input.nav)) {
    cfg.nav.top = asNavItems(input.nav.top) ?? cfg.nav.top;
    cfg.nav.more = asNavItems(input.nav.more) ?? cfg.nav.more;
  }

  if (isObject(input.content)) {
    cfg.content = cfg.content ?? {
      rootPageId: null,
      homePageId: null,
      routeOverrides: null,
      sitemapExcludes: [],
      sitemapAutoExclude: normalizeSitemapAutoExclude(undefined),
    };
    cfg.content.rootPageId = asNullableString(input.content.rootPageId) ?? cfg.content.rootPageId;
    cfg.content.homePageId = asNullableString(input.content.homePageId) ?? cfg.content.homePageId;
    cfg.content.routeOverrides = asRouteOverrides(input.content.routeOverrides) ?? cfg.content.routeOverrides;
    cfg.content.sitemapExcludes = asSitemapExcludes(input.content.sitemapExcludes) ?? cfg.content.sitemapExcludes;
    cfg.content.sitemapAutoExclude = asSitemapAutoExclude(input.content.sitemapAutoExclude);
  }

  return cfg;
}

export function getSiteConfig(): SiteConfig {
  const parsed = readContentJson("site-config.json") ?? filesystemSiteConfig ?? generatedSiteConfig;
  if (!parsed) return DEFAULT_CONFIG;
  return normalizeConfig(parsed);
}
