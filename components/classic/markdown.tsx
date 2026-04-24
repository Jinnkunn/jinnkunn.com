import "server-only";

import type { ReactElement } from "react";

import { postMdxComponents } from "@/components/posts-mdx/components";
import { compilePostMdx } from "@/lib/posts/compile";
import { renderSimpleMarkdown } from "@/lib/posts/simple-markdown";

export async function renderPostMarkdown(
  source?: string,
): Promise<ReactElement | null> {
  if (!source?.trim()) return null;
  const { Content } = await compilePostMdx(source);
  return <Content components={postMdxComponents} />;
}

export async function renderSimpleClassicMarkdown(
  source?: string,
): Promise<ReactElement | null> {
  if (!source?.trim()) return null;
  return renderSimpleMarkdown(source);
}
