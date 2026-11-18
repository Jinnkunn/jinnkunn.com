import "server-only";
import type { BlogPostIndexItem } from "@/lib/blog";
import type { SeriesLink } from "@/lib/posts/reasoning-drift-series";
import type { PostEntry } from "@jinnkunn/content-core/posts";
import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "./components";
import { PostArticle } from "./document-layouts";

export async function PostView({ entry, source, prev = null, next = null, series = [] }: {
  entry: PostEntry; source: string; prev?: BlogPostIndexItem | null; next?: BlogPostIndexItem | null; series?: SeriesLink[];
}) {
  const { Content, headings } = await compilePostMdx(source);
  return <PostArticle entry={entry} headings={headings} prev={prev} next={next} series={series}><Content components={postMdxComponents} /></PostArticle>;
}
