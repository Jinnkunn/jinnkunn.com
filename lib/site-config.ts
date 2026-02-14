import { readContentJson } from "@/lib/server/content-json";
import { DEFAULT_SITE_CONFIG } from "@/lib/shared/default-site-config";

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
  };
};

const DEFAULT_CONFIG: SiteConfig = DEFAULT_SITE_CONFIG;

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function asString(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() ? x : undefined;
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

  if (isObject(input.nav)) {
    cfg.nav.top = asNavItems(input.nav.top) ?? cfg.nav.top;
    cfg.nav.more = asNavItems(input.nav.more) ?? cfg.nav.more;
  }

  return cfg;
}

export function getSiteConfig(): SiteConfig {
  const parsed = readContentJson("site-config.json");
  if (!parsed) return DEFAULT_CONFIG;
  return normalizeConfig(parsed);
}
