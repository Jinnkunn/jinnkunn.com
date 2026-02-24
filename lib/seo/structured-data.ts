import type { SiteConfig } from "@/lib/site-config";

import { canonicalAbsolute, detectSiteOrigin } from "./metadata";

type JsonLdObject = Record<string, unknown>;

function personName(cfg: SiteConfig): string {
  const site = String(cfg.siteName || "").trim();
  if (!site) return "Jinkun Chen";
  return site.replace(/\s*\.+\s*$/, "") || "Jinkun Chen";
}

function baseIds() {
  const origin = detectSiteOrigin();
  return {
    origin,
    personId: `${origin}/#person`,
    websiteId: `${origin}/#website`,
  };
}

export function buildPersonStructuredData(cfg: SiteConfig): JsonLdObject {
  const ids = baseIds();
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": ids.personId,
    name: personName(cfg),
    url: canonicalAbsolute("/"),
  };
}

export function buildWebsiteStructuredData(cfg: SiteConfig): JsonLdObject {
  const ids = baseIds();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": ids.websiteId,
    url: canonicalAbsolute("/"),
    name: cfg.siteName || cfg.seo.title || personName(cfg),
    inLanguage: cfg.lang || "en",
    publisher: { "@id": ids.personId },
  };
}

export function buildBreadcrumbStructuredData(
  items: Array<{ name: string; pathname: string }>,
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: canonicalAbsolute(item.pathname),
    })),
  };
}

export function buildHomeStructuredData(cfg: SiteConfig): JsonLdObject[] {
  const ids = baseIds();
  const person = buildPersonStructuredData(cfg);
  const website = buildWebsiteStructuredData(cfg);
  const webpage: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonicalAbsolute("/"),
    url: canonicalAbsolute("/"),
    name: cfg.seo.title || cfg.siteName || personName(cfg),
    description: cfg.seo.description,
    isPartOf: { "@id": ids.websiteId },
    about: { "@id": ids.personId },
  };
  return [person, website, webpage];
}

export function buildBlogIndexStructuredData(
  cfg: SiteConfig,
  posts: Array<{ title: string; pathname: string; dateIso?: string | null }>,
): JsonLdObject[] {
  const ids = baseIds();
  const person = buildPersonStructuredData(cfg);
  const website = buildWebsiteStructuredData(cfg);
  const blog: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": canonicalAbsolute("/blog"),
    url: canonicalAbsolute("/blog"),
    name: "Blog",
    description: cfg.seo.description,
    inLanguage: cfg.lang || "en",
    isPartOf: { "@id": ids.websiteId },
    author: { "@id": ids.personId },
    blogPost: posts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      url: canonicalAbsolute(post.pathname),
      ...(post.dateIso ? { datePublished: post.dateIso } : {}),
    })),
  };
  const crumbs = buildBreadcrumbStructuredData([
    { name: "Home", pathname: "/" },
    { name: "Blog", pathname: "/blog" },
  ]);
  return [person, website, blog, crumbs];
}

export function buildBlogPostStructuredData(
  cfg: SiteConfig,
  input: {
    slug: string;
    title: string;
    description: string;
    publishedTime?: string | null;
    modifiedTime?: string | null;
  },
): JsonLdObject[] {
  const ids = baseIds();
  const pathname = `/blog/${input.slug}`;
  const person = buildPersonStructuredData(cfg);
  const website = buildWebsiteStructuredData(cfg);
  const article: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": canonicalAbsolute(pathname),
    url: canonicalAbsolute(pathname),
    headline: input.title,
    description: input.description,
    author: { "@id": ids.personId },
    publisher: { "@id": ids.personId },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalAbsolute(pathname) },
    ...(input.publishedTime ? { datePublished: input.publishedTime } : {}),
    ...(input.modifiedTime ? { dateModified: input.modifiedTime } : {}),
  };
  const crumbs = buildBreadcrumbStructuredData([
    { name: "Home", pathname: "/" },
    { name: "Blog", pathname: "/blog" },
    { name: input.title, pathname },
  ]);
  return [person, website, article, crumbs];
}

export function buildPublicationsStructuredData(
  cfg: SiteConfig,
  input: { title: string; description: string },
): JsonLdObject[] {
  const ids = baseIds();
  const pathname = "/publications";
  const person = buildPersonStructuredData(cfg);
  const website = buildWebsiteStructuredData(cfg);
  const page: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": canonicalAbsolute(pathname),
    url: canonicalAbsolute(pathname),
    name: input.title || "Publications",
    description: input.description || cfg.seo.description,
    inLanguage: cfg.lang || "en",
    isPartOf: { "@id": ids.websiteId },
    author: { "@id": ids.personId },
    about: [
      { "@type": "Thing", name: "Research Publications" },
      { "@type": "Thing", name: "Scholarly Articles" },
    ],
  };
  const crumbs = buildBreadcrumbStructuredData([
    { name: "Home", pathname: "/" },
    { name: input.title || "Publications", pathname },
  ]);
  return [person, website, page, crumbs];
}
