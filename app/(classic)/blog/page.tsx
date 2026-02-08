import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { getRoutesManifest } from "@/lib/routes-manifest";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Blog",
  description: "Jinkun's Blog",
};

async function loadNotionBlogMain(): Promise<string> {
  // Prefer canonical /blog.
  try {
    return await loadRawMainHtml("blog");
  } catch {
    // Fallback: find the Notion page titled "Blog" and use its route.
    const items = getRoutesManifest();
    const cand = items.find((it) => it.kind === "page" && it.title.trim().toLowerCase() === "blog");
    if (cand?.routePath) {
      const route = cand.routePath.replace(/^\/+/, "");
      return await loadRawMainHtml(route || "index");
    }
    throw new Error("Missing blog.html");
  }
}

export default async function BlogPage() {
  let html = "";
  try {
    html = await loadNotionBlogMain();
  } catch {
    notFound();
  }
  return <RawHtml html={html} />;
}
