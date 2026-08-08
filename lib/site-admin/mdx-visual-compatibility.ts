import { createProcessor } from "@mdx-js/mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export type VisualMdxCompatibilityIssue = {
  code:
    | "expression"
    | "inline-component"
    | "module-syntax"
    | "paired-component"
    | "dynamic-component-attribute"
    | "unsupported-jsx"
    | "syntax-error";
  line?: number;
  message: string;
};

export type VisualMdxCompatibility = {
  compatible: boolean;
  issues: VisualMdxCompatibilityIssue[];
};

type MdxAstNode = {
  type?: string;
  name?: string | null;
  attributes?: Array<{
    type?: string;
    value?: unknown;
  }>;
  children?: MdxAstNode[];
  position?: {
    start?: { line?: number; offset?: number };
    end?: { line?: number; offset?: number };
  };
};

const visualCompatibilityProcessor = createProcessor({
  format: "mdx",
  remarkPlugins: [[remarkFrontmatter, ["yaml"]], remarkGfm, remarkMath],
});

function nodeLine(node: MdxAstNode): number | undefined {
  const line = node.position?.start?.line;
  return typeof line === "number" && Number.isFinite(line) ? line : undefined;
}

function sourceForNode(source: string, node: MdxAstNode): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return "";
  return source.slice(start, end);
}

function isStaticSelfClosingComponent(source: string, node: MdxAstNode): boolean {
  const name = node.name || "";
  if (!/^[A-Z][A-Za-z0-9.]*$/.test(name)) return false;
  if ((node.children?.length || 0) > 0) return false;
  if (!sourceForNode(source, node).trimEnd().endsWith("/>")) return false;
  return (node.attributes || []).every(
    (attribute) =>
      attribute.type === "mdxJsxAttribute" &&
      (attribute.value === null || typeof attribute.value === "string"),
  );
}

function componentIssue(source: string, node: MdxAstNode): VisualMdxCompatibilityIssue {
  const name = node.name || "component";
  const line = nodeLine(node);
  const hasDynamicAttribute = (node.attributes || []).some(
    (attribute) =>
      attribute.type !== "mdxJsxAttribute" ||
      (attribute.value !== null && typeof attribute.value !== "string"),
  );
  if (hasDynamicAttribute) {
    return {
      code: "dynamic-component-attribute",
      line,
      message: `Expression attributes on <${name}> need Source mode.`,
    };
  }
  if (/^[A-Z][A-Za-z0-9.]*$/.test(name) && !sourceForNode(source, node).trimEnd().endsWith("/>")) {
    return {
      code: "paired-component",
      line,
      message: `Paired <${name}> content needs Source mode.`,
    };
  }
  return {
    code: "unsupported-jsx",
    line,
    message: `JSX block <${name}> needs Source mode.`,
  };
}

function syntaxErrorLine(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    line?: unknown;
    place?: { start?: { line?: unknown } };
  };
  const line = candidate.place?.start?.line ?? candidate.line;
  return typeof line === "number" && Number.isFinite(line) ? line : undefined;
}

export function analyzeVisualMdxCompatibility(source: string): VisualMdxCompatibility {
  let root: MdxAstNode;
  try {
    root = visualCompatibilityProcessor.parse(String(source || "")) as MdxAstNode;
  } catch (error) {
    return {
      compatible: false,
      issues: [
        {
          code: "syntax-error",
          line: syntaxErrorLine(error),
          message: "This MDX could not be parsed safely. Fix it in Source mode.",
        },
      ],
    };
  }

  const issues: VisualMdxCompatibilityIssue[] = [];
  const visit = (node: MdxAstNode) => {
    switch (node.type) {
      case "mdxjsEsm":
        issues.push({
          code: "module-syntax",
          line: nodeLine(node),
          message: "MDX import/export statements need Source mode.",
        });
        return;
      case "mdxFlowExpression":
      case "mdxTextExpression":
        issues.push({
          code: "expression",
          line: nodeLine(node),
          message: "MDX expressions in {...} need Source mode.",
        });
        return;
      case "mdxJsxTextElement":
        issues.push({
          code: "inline-component",
          line: nodeLine(node),
          message: "Inline MDX components need Source mode.",
        });
        return;
      case "mdxJsxFlowElement":
        if (!isStaticSelfClosingComponent(source, node)) {
          issues.push(componentIssue(source, node));
        }
        return;
      default:
        node.children?.forEach(visit);
    }
  };

  visit(root);
  return { compatible: issues.length === 0, issues };
}

export function visualCompatibilitySummary(
  compatibility: VisualMdxCompatibility,
): string {
  const first = compatibility.issues[0];
  if (!first) return "Write mode is available.";
  const prefix = first.line ? `Line ${first.line}: ` : "";
  const remaining = compatibility.issues.length - 1;
  return `${prefix}${first.message}${remaining > 0 ? ` ${remaining} more issue${remaining === 1 ? "" : "s"}.` : ""}`;
}
