import "server-only";
import type { BlogPostIndexItem } from "@/lib/blog";
import type { PostEntry } from "@jinnkunn/content-core/posts";
import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "./components";
import { PostArticle } from "./document-layouts";

export async function PostView({ entry, source, prev = null, next = null }: {
  entry: PostEntry; source: string; prev?: BlogPostIndexItem | null; next?: BlogPostIndexItem | null;
}) {
  const { Content, headings } = await compilePostMdx(source);
  return <PostArticle entry={entry} headings={headings} prev={prev} next={next}><Content components={postMdxComponents} /></PostArticle>;
}
