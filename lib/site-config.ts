import { readContentJson } from "@/lib/server/content-json";
import { DEFAULT_SITE_CONFIG } from "@/lib/shared/default-site-config";
import { normalizeGithubUserList } from "@/lib/shared/github-users";
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
  };
  integrations?: {
    googleAnalyticsId?: string; // GA4 measurement ID (e.g. "G-XXXXXXX")
  };
  security?: {
    contentGithubUsers?: string[];
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
  };
};

const DEFAULT_CONFIG: SiteConfig = DEFAULT_SITE_CONFIG;

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function asString(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() ? x : undefined;
}

function asNullableString(x: unknown): string | null | undefined {
  if (x === null) return null;
  return asString(x);
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

function asNavItems(x: unknown): NavItem[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: NavItem[] = [];
  for (const it of x) {
    if (!isObject(it)) continue;
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

  cfg.siteName = asString(input.siteName) ?? cfg.siteName;
  cfg.lang = asString(input.lang) ?? cfg.lang;

  if (isObject(input.seo)) {
    cfg.seo.title = asString(input.seo.title) ?? cfg.seo.title;
    cfg.seo.description =
      asString(input.seo.description) ?? cfg.seo.description;
    cfg.seo.favicon = asString(input.seo.favicon) ?? cfg.seo.favicon;
  }

  if (isObject(input.integrations)) {
    cfg.integrations = cfg.integrations ?? {};
    cfg.integrations.googleAnalyticsId =
      asString(input.integrations.googleAnalyticsId) ??
      cfg.integrations.googleAnalyticsId;
  }

  if (isObject(input.security)) {
    cfg.security = cfg.security ?? { contentGithubUsers: [] };
    cfg.security.contentGithubUsers = normalizeGithubUserList(input.security.contentGithubUsers);
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
    };
    cfg.content.rootPageId = asNullableString(input.content.rootPageId) ?? cfg.content.rootPageId;
    cfg.content.homePageId = asNullableString(input.content.homePageId) ?? cfg.content.homePageId;
    cfg.content.routeOverrides = asRouteOverrides(input.content.routeOverrides) ?? cfg.content.routeOverrides;
    cfg.content.sitemapExcludes = asSitemapExcludes(input.content.sitemapExcludes) ?? cfg.content.sitemapExcludes;
  }

  return cfg;
}

export function getSiteConfig(): SiteConfig {
  const parsed = readContentJson("site-config.json");
  if (!parsed) return DEFAULT_CONFIG;
  return normalizeConfig(parsed);
}
