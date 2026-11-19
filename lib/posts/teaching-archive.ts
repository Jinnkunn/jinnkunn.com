import type { PhrasingContent, Root } from "mdast";

function unwrap(node: PhrasingContent): PhrasingContent {
  if ((node.type === "strong" || node.type === "emphasis") && node.children.length === 1) {
    return unwrap(node.children[0]);
  }
  return node;
}

function separator(node: PhrasingContent): boolean {
  const content = unwrap(node);
  return content.type === "text" && /^[\s|\u00b7]*$/.test(content.value);
}

function archiveLink(node: PhrasingContent): boolean {
  const content = unwrap(node);
  return content.type === "link" && /^\/(?:pages\/)?teaching\/archive\/?$/.test(content.url);
}

/** Deduplicate archive controls in legacy link rows without rewriting authored prose. */
export function compactTeachingArchiveLinks(tree: Root): void {
  let keptArchive = false;
  tree.children = tree.children.filter((paragraph) => {
    if (paragraph.type !== "paragraph" || !paragraph.children.some(archiveLink) ||
        !paragraph.children.every((node) => unwrap(node).type === "link" || separator(node))) return true;
    const row: PhrasingContent[] = [];
    for (let i = 0; i < paragraph.children.length; i++) {
      const node = paragraph.children[i];
      if (!archiveLink(node)) {
        row.push(node);
        continue;
      }
      if (!keptArchive) {
        keptArchive = true;
        row.push(node);
      } else if (paragraph.children[i + 1] && separator(paragraph.children[i + 1])) {
        i++;
      } else if (row.length && separator(row[row.length - 1])) {
        row.pop();
      }
    }
    paragraph.children = row;
    return row.some((node) => !separator(node));
  });
}
