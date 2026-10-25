import type { ReactElement } from "react";
import * as runtime from "react/jsx-runtime";
import { createProcessor } from "@mdx-js/mdx";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeKatex from "rehype-katex";
import type { MDXComponents } from "mdx/types";
import { collectPostHeadings, type PostHeading } from "./outline.ts";
import { staticMdxExpression } from "../site-admin/mdx-static-expressions.ts";

type PreviewNode = { type?: string; name?: string; attributes?: { type?: string; name?: string }[]; children?: PreviewNode[] };
function validateElements(node: PreviewNode) {
  if (node.type === "mdxjsEsm") throw new Error("Module code is not executed in previews.");
  if (node.type?.startsWith("mdxJsx")) {
    if (["script", "style", "iframe", "object", "embed", "base", "meta", "link"].includes(node.name?.toLowerCase() || "")) throw new Error("Active HTML is not supported in previews.");
    for (const attribute of node.attributes || []) {
      if (attribute.type !== "mdxJsxAttribute" || /^(on[A-Z]|on[a-z])/.test(attribute.name || "") || ["dangerouslySetInnerHTML", "srcDoc"].includes(attribute.name || "")) throw new Error("Active attributes are not supported in previews.");
    }
  }
  node.children?.forEach(validateElements);
}

function aliasComponents(node: PreviewNode, aliases: Map<string, string>) {
  if (node.type?.startsWith("mdxJsx") && node.name && /^[A-Z]/.test(node.name)) {
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(node.name)) throw new Error("Unsupported preview component name.");
    const alias = `preview-mdx-${node.name}`;
    aliases.set(alias, node.name);
    node.name = alias;
  }
  node.children?.forEach((child) => aliasComponents(child, aliases));
}

export async function compilePreviewMdx(source: string): Promise<{ Content: (props: { components?: MDXComponents }) => ReactElement; headings: PostHeading[] }> {
  const parser = createProcessor({ remarkPlugins: [[remarkFrontmatter, ["yaml"]], remarkGfm, remarkMath] });
  const mdast = parser.parse(source);
  mdast.children = mdast.children.filter((node) => node.type !== "yaml");
  validateElements(mdast as PreviewNode);
  // JSX names resolve only through the supplied component registry. The
  // expression evaluator remains limited to data, including attribute values.
  const aliases = new Map<string, string>();
  aliasComponents(mdast as PreviewNode, aliases);
  let headings: PostHeading[] = [];
  const processor = unified().use(remarkRehype, { passThrough: ["mdxjsEsm", "mdxFlowExpression", "mdxTextExpression", "mdxJsxFlowElement", "mdxJsxTextElement"] })
    .use(rehypeSlug)
    .use(() => (tree) => { headings = collectPostHeadings(tree); })
    .use(rehypeAutolinkHeadings, { behavior: "wrap", properties: { className: "notion-heading__anchor-link" } })
    .use(rehypeKatex, { strict: false, throwOnError: false });
  const hast = await processor.run(mdast);
  return {
    headings,
    Content: ({ components }) => {
      const registry = { ...components };
      for (const [alias, name] of aliases) {
        if (!components || !Object.hasOwn(components, name)) throw new Error(`Unsupported preview component: ${name}`);
        registry[alias] = components[name];
      }
      return toJsxRuntime(hast as Parameters<typeof toJsxRuntime>[0], {
        ...runtime, components: registry as Parameters<typeof toJsxRuntime>[1]["components"],
        createEvaluater: () => ({ evaluateExpression: staticMdxExpression, evaluateProgram: () => { throw new Error("Module code is not executed in previews."); } }),
      });
    },
  };
}
