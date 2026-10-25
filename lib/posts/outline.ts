export type PostHeading = { id: string; title: string; level: number };
type HeadingNode = { type?: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HeadingNode[] };

export function collectPostHeadings(tree: HeadingNode): PostHeading[] {
  const headings: PostHeading[] = [];
  function text(node: HeadingNode): string {
    if (node.properties?.ariaHidden === "true" || node.properties?.ariaHidden === true || node.tagName === "script" || node.tagName === "style") return "";
    return node.value || node.children?.map(text).join("") || "";
  }
  function walk(node: HeadingNode) {
    if (/^h[23]$/.test(node.tagName || "") && typeof node.properties?.id === "string") {
      const title = text(node).replace(/\s+/g, " ").trim();
      if (title) headings.push({ id: node.properties.id, title, level: Number(node.tagName!.slice(1)) });
    }
    node.children?.forEach(walk);
  }
  walk(tree);
  return headings.slice(0, 100);
}

export function shouldShowPostOutline(wordCount: number, headings: PostHeading[]): boolean {
  return wordCount >= 600 && headings.length >= 3;
}
