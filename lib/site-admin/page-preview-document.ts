import { parsePostFile, type PostEntry } from "@jinnkunn/content-core/posts";
import { parsePageFile } from "@jinnkunn/content-core/pages";
import { getSiteComponentDefinition } from "./component-registry.ts";
import { adjacentBlogDocuments } from "../posts/navigation.ts";
import type { PagePreviewOptions } from "./page-preview-context.ts";

export function resolvePagePreviewDocument(input: PagePreviewOptions & { source: string }, published: Record<string, string>) {
  const sources = input.component ? { ...published, [`components/${input.component}.mdx`]: input.source } : published;
  const route = input.routePath || (input.home ? "/" : "/preview");
  if (input.home || route === "/") {
    const home = sources["home.json"] ? JSON.parse(sources["home.json"]) : {};
    return { kind: "home" as const, source: input.announcement ? String(home.bodyMdx || "") : input.source, title: input.announcement ? String(home.title || input.title) : input.title, sources };
  }
  const slug = input.document?.slug || route.replace(/^\/(?:pages\/|blog\/)?/, "");
  const kind = input.document?.kind || (route.startsWith("/blog/") ? "posts" : "pages");
  let source = input.document?.source ?? input.source;
  if (input.announcement || input.component) {
    const fallback = input.component ? `<${getSiteComponentDefinition(input.component).embedTag} />` : source;
    source = sources[`${kind}/${slug}.mdx`] ?? fallback;
  }
  if (kind === "posts") {
    const parsed = parsePostFile(slug, source, { allowIncomplete: true });
    const entry = { ...parsed.entry, title: input.document || input.announcement ? parsed.entry.title : input.title };
    const entries: PostEntry[] = [entry];
    for (const [path, content] of Object.entries(sources)) {
      if (!path.startsWith("posts/") || !path.endsWith(".mdx") || path === `posts/${slug}.mdx`) continue;
      try { const post = parsePostFile(path.slice(6, -4), content).entry; if (!post.draft) entries.push(post); } catch { /* Invalid unpublished sources do not become neighbours. */ }
    }
    return { kind: "posts" as const, entry, source: parsed.body, adjacent: adjacentBlogDocuments(entries, entry.href), sources };
  }
  const parsed = parsePageFile(slug, source, { allowIncomplete: true });
  const entry = { ...parsed.entry, title: input.document || input.announcement || input.component ? parsed.entry.title || input.title : input.title };
  const segments = slug.split("/");
  const trail: { label: string; href: string | null }[] = [];
  for (let index = 0; index < segments.length - 1; index++) {
    const parent = segments.slice(0, index + 1).join("/");
    let title = "";
    try { if (sources[`pages/${parent}.mdx`]) title = parsePageFile(parent, sources[`pages/${parent}.mdx`]).entry.title; } catch { /* Folder-only trail item. */ }
    trail.push({ label: title || segments[index], href: title ? `/${parent}` : null });
  }
  trail.push({ label: entry.title || "Untitled Page", href: `/${slug}` });
  return { kind: "pages" as const, entry, source: parsed.body, trail, sources };
}
