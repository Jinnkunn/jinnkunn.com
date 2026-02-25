import "server-only";

import {
  buildOrderedSitemapRows,
  collectSitemapSnapshot,
  latestLastmod,
  resolveLastmod,
} from "@/lib/server/sitemap-core";
import {
  SITEMAP_SECTIONS,
  sectionForRoutePath,
  type SitemapSection,
} from "@/lib/shared/sitemap-policy";

export type SitemapRoute = {
  routePath: string;
  title: string;
  parentRoutePath: string;
  depth: number;
};

export const SITEMAP_SECTION_ORDER = SITEMAP_SECTIONS;

export const SITEMAP_SECTION_PATHS: Record<SitemapSection, string> = {
  pages: "/sitemap-pages.xml",
  blog: "/sitemap-blog.xml",
  publications: "/sitemap-publications.xml",
  teaching: "/sitemap-teaching.xml",
};

export type SitemapUrl = {
  routePath: string;
  section: SitemapSection;
  lastmod: string | null;
};

export type SitemapSectionDoc = {
  section: SitemapSection;
  path: string;
  urls: SitemapUrl[];
  lastmod: string | null;
};

export function getHierarchicalSitemapRoutes(): SitemapRoute[] {
  const snapshot = collectSitemapSnapshot();
  return buildOrderedSitemapRows(snapshot.nodes);
}

export function getHierarchicalSitemapRoutePaths(): string[] {
  return getHierarchicalSitemapRoutes().map((row) => row.routePath);
}

export function getSitemapUrls(): SitemapUrl[] {
  const snapshot = collectSitemapSnapshot();
  const ordered = buildOrderedSitemapRows(snapshot.nodes);
  return ordered.map((row) => ({
    routePath: row.routePath,
    section: sectionForRoutePath(row.routePath),
    lastmod: resolveLastmod(snapshot.routeMtimeMs.get(row.routePath), snapshot.fallbackLastmod),
  }));
}

export function getSitemapSectionUrls(section: SitemapSection): SitemapUrl[] {
  return getSitemapUrls().filter((row) => row.section === section);
}

export function getSitemapSectionDocs(): SitemapSectionDoc[] {
  const all = getSitemapUrls();
  const bySection = new Map<SitemapSection, SitemapUrl[]>();
  for (const section of SITEMAP_SECTION_ORDER) bySection.set(section, []);
  for (const row of all) bySection.get(row.section)?.push(row);

  return SITEMAP_SECTION_ORDER.map((section) => {
    const urls = bySection.get(section) || [];
    return {
      section,
      path: SITEMAP_SECTION_PATHS[section],
      urls,
      lastmod: latestLastmod(urls.map((u) => u.lastmod)),
    };
  });
}
