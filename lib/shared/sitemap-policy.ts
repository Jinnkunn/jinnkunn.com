import { normalizeRoutePath } from "./route-utils.ts";

export const SITEMAP_SECTIONS = ["pages", "blog", "publications", "teaching"] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

export type SitemapAutoExcludeConfig = {
  enabled: boolean;
  excludeSections: SitemapSection[];
  maxDepthBySection: Partial<Record<SitemapSection, number>>;
};

export const DEFAULT_SITEMAP_AUTO_EXCLUDE: SitemapAutoExcludeConfig = {
  enabled: true,
  excludeSections: [],
  maxDepthBySection: {
    // Keep broad teaching hubs indexed but drop very deep timeline leaves by default.
    teaching: 5,
  },
};

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function isSitemapSection(x: string): x is SitemapSection {
  return (SITEMAP_SECTIONS as readonly string[]).includes(x);
}

export function parseSitemapSectionList(raw: string): SitemapSection[] {
  const list = String(raw || "")
    .split(/[\s,\n]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<SitemapSection>();
  const out: SitemapSection[] = [];
  for (const item of list) {
    if (!isSitemapSection(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function parseEnabled(input: unknown): boolean {
  return typeof input === "boolean" ? input : DEFAULT_SITEMAP_AUTO_EXCLUDE.enabled;
}

function normalizeExcludeSections(input: unknown): SitemapSection[] {
  if (!Array.isArray(input)) return [...DEFAULT_SITEMAP_AUTO_EXCLUDE.excludeSections];
  const seen = new Set<SitemapSection>();
  const out: SitemapSection[] = [];
  for (const value of input) {
    const section = String(value || "").trim().toLowerCase();
    if (!isSitemapSection(section)) continue;
    if (seen.has(section)) continue;
    seen.add(section);
    out.push(section);
  }
  return out;
}

function normalizeMaxDepthBySection(input: unknown): Partial<Record<SitemapSection, number>> {
  const out: Partial<Record<SitemapSection, number>> = {
    ...DEFAULT_SITEMAP_AUTO_EXCLUDE.maxDepthBySection,
  };
  if (!isObject(input)) return out;

  for (const section of SITEMAP_SECTIONS) {
    if (!(section in input)) continue;
    const raw = input[section];
    if (raw === null || raw === false) {
      delete out[section];
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const normalized = Math.max(0, Math.min(20, Math.floor(n)));
    out[section] = normalized;
  }
  return out;
}

export function normalizeSitemapAutoExclude(input: unknown): SitemapAutoExcludeConfig {
  if (!isObject(input)) {
    return {
      enabled: DEFAULT_SITEMAP_AUTO_EXCLUDE.enabled,
      excludeSections: [...DEFAULT_SITEMAP_AUTO_EXCLUDE.excludeSections],
      maxDepthBySection: { ...DEFAULT_SITEMAP_AUTO_EXCLUDE.maxDepthBySection },
    };
  }

  return {
    enabled: parseEnabled(input.enabled),
    excludeSections: normalizeExcludeSections(input.excludeSections),
    maxDepthBySection: normalizeMaxDepthBySection(input.maxDepthBySection),
  };
}

export function sectionForRoutePath(routePath: string): SitemapSection {
  const p = normalizeRoutePath(routePath) || "/";
  if (p === "/blog" || p.startsWith("/blog/")) return "blog";
  if (p === "/publications" || p.startsWith("/publications/")) return "publications";
  if (p === "/teaching" || p.startsWith("/teaching/")) return "teaching";
  return "pages";
}

export function routePathDepth(routePath: string): number {
  const p = normalizeRoutePath(routePath) || "/";
  if (p === "/") return 0;
  return p.split("/").filter(Boolean).length;
}

export function shouldAutoExcludeFromSitemap(
  routePath: string,
  config: SitemapAutoExcludeConfig,
): boolean {
  if (!config.enabled) return false;
  const section = sectionForRoutePath(routePath);
  if (config.excludeSections.includes(section)) return true;

  const maxDepth = config.maxDepthBySection[section];
  if (typeof maxDepth !== "number" || !Number.isFinite(maxDepth)) return false;
  return routePathDepth(routePath) > maxDepth;
}
