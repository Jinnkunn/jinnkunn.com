import "server-only";

import { listPages, readPage } from "@/lib/pages/store";
import { listPosts, readPost } from "@/lib/posts/store";
import { loadSiteAdminHomeData } from "@/lib/server/site-admin-home-service";

import {
  findComponentUsagesInSources,
  type ComponentUsageMap,
  type ComponentUsageSource,
} from "./usage.ts";

function pageRoute(slug: string): string {
  if (!slug || slug === "index") return "/";
  return `/${slug.replace(/^\/+/, "")}`;
}

function postRoute(slug: string): string {
  return `/blog/${slug.replace(/^\/+/, "")}`;
}

export async function loadComponentUsageMap(): Promise<ComponentUsageMap> {
  const sources: ComponentUsageSource[] = [];

  const home = await loadSiteAdminHomeData();
  const homeBody = home.data.bodyMdx ?? "";
  if (homeBody.trim()) {
    sources.push({
      kind: "home",
      sourcePath: "content/home.json",
      routePath: "/",
      title: home.data.title || "Home",
      source: homeBody,
    });
  }

  const pages = await listPages({ includeDrafts: true });
  await Promise.all(
    pages.map(async ({ entry }) => {
      const detail = await readPage(entry.slug);
      if (!detail) return;
      sources.push({
        kind: "page",
        sourcePath: `content/pages/${entry.slug}.mdx`,
        routePath: pageRoute(entry.slug),
        title: entry.title || entry.slug,
        source: detail.source,
      });
    }),
  );

  const posts = await listPosts({ includeDrafts: true });
  await Promise.all(
    posts.map(async ({ entry }) => {
      const detail = await readPost(entry.slug);
      if (!detail) return;
      sources.push({
        kind: "post",
        sourcePath: `content/posts/${entry.slug}.mdx`,
        routePath: postRoute(entry.slug),
        title: entry.title || entry.slug,
        source: detail.source,
      });
    }),
  );

  return findComponentUsagesInSources(sources);
}
