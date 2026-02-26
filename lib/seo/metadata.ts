import type { Metadata } from "next";

import type { SiteConfig } from "../site-config.ts";
import { canonicalizePublicRoute } from "../routes/strategy.ts";
import { normalizeRoutePath } from "../shared/route-utils.ts";
import type { SeoPageOverride } from "../shared/seo-page-overrides.ts";

const FALLBACK_SITE_ORIGIN = "https://jinkunchen.com";

function trimTrailingSlash(input: string): string {
  const s = String(input || "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

export function normalizeSiteOrigin(raw: string): string | null {
  const value = trimTrailingSlash(raw);
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }
  if (!/^[a-z0-9.-]+$/i.test(value)) return null;
  return `https://${value}`;
}

export function detectSiteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    env.NEXT_PUBLIC_SITE_URL,
    env.SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
  ];
  for (const c of candidates) {
    const n = normalizeSiteOrigin(String(c || ""));
    if (n) return n;
  }
  return FALLBACK_SITE_ORIGIN;
}

export function getMetadataBase(): URL {
  return new URL(detectSiteOrigin());
}

export function canonicalPath(pathname: string): string {
  const normalized = normalizeRoutePath(pathname);
  if (!normalized) return "/";
  return normalizeRoutePath(canonicalizePublicRoute(normalized)) || "/";
}

export function canonicalAbsolute(pathname: string): string {
  return new URL(canonicalPath(pathname), getMetadataBase()).toString();
}

function localeFromLang(lang: string): string {
  const v = String(lang || "").trim().toLowerCase();
  if (!v) return "en_US";
  if (v === "en") return "en_US";
  if (v.includes("-")) {
    const [l, r] = v.split("-", 2);
    if (l && r) return `${l.toLowerCase()}_${r.toUpperCase()}`;
  }
  return `${v}_US`;
}

function normalizeImagePath(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function defaultSocialImage(cfg: SiteConfig): string {
  const configured = normalizeImagePath(cfg.seo.ogImage || "");
  if (configured) return configured;
  return "/assets/profile.png";
}

function readPageOverride(cfg: SiteConfig, pathname: string): SeoPageOverride | null {
  const all = cfg?.seo?.pageOverrides;
  if (!all || typeof all !== "object") return null;
  const key = canonicalPath(pathname);
  const raw = (all as Record<string, unknown>)[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as SeoPageOverride;
}

type BuildPageMetadataInput = {
  cfg: SiteConfig;
  title: string;
  description?: string | null;
  pathname: string;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
};

export function buildPageMetadata(input: BuildPageMetadataInput): Metadata {
  const cfg = input.cfg;
  const pageOverride = readPageOverride(cfg, input.pathname);
  const title =
    String(pageOverride?.title || "").trim() ||
    String(input.title || "").trim() ||
    cfg.seo.title ||
    cfg.siteName;
  const description =
    String(pageOverride?.description || "").trim() ||
    String(input.description || cfg.seo.description || "").trim();
  const canonical = pageOverride?.canonicalPath
    ? canonicalPath(pageOverride.canonicalPath)
    : canonicalPath(input.pathname);
  const siteName = cfg.siteName || cfg.seo.title || title;
  const ogType = input.type === "article" ? "article" : "website";
  const socialImage = normalizeImagePath(pageOverride?.ogImage || "") || defaultSocialImage(cfg);
  const openGraphImages = [{ url: socialImage }];

  const openGraphBase = {
    type: ogType,
    siteName,
    title,
    description,
    locale: localeFromLang(cfg.lang || "en"),
    url: canonical,
    images: openGraphImages,
  };

  return {
    metadataBase: getMetadataBase(),
    title,
    description,
    alternates: { canonical },
    openGraph:
      ogType === "article"
        ? {
            ...openGraphBase,
            publishedTime: input.publishedTime,
            modifiedTime: input.modifiedTime,
          }
        : openGraphBase,
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
    robots: pageOverride?.noindex ? { index: false, follow: false } : undefined,
    icons: cfg.seo.favicon ? [{ rel: "icon", url: cfg.seo.favicon }] : undefined,
  };
}

export function buildRootMetadata(cfg: SiteConfig): Metadata {
  const homeOverride = readPageOverride(cfg, "/");
  const baseTitle =
    String(homeOverride?.title || "").trim() ||
    cfg.seo.title ||
    cfg.siteName;
  const description =
    String(homeOverride?.description || "").trim() ||
    cfg.seo.description;
  const socialImage = normalizeImagePath(homeOverride?.ogImage || "") || defaultSocialImage(cfg);
  const canonical = homeOverride?.canonicalPath ? canonicalPath(homeOverride.canonicalPath) : "/";

  return {
    metadataBase: getMetadataBase(),
    title: {
      default: baseTitle,
      template: `%s | ${baseTitle}`,
    },
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: cfg.siteName || baseTitle,
      title: baseTitle,
      description,
      locale: localeFromLang(cfg.lang || "en"),
      url: canonical,
      images: [{ url: socialImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: baseTitle,
      description,
      images: [socialImage],
    },
    robots: homeOverride?.noindex ? { index: false, follow: false } : undefined,
    icons: cfg.seo.favicon ? [{ rel: "icon", url: cfg.seo.favicon }] : undefined,
  };
}
