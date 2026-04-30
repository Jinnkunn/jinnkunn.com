import type { MdxBlock } from "./mdx-blocks";
import { isBlockVisuallyEmpty } from "./mdx-block-utils";

export type EditorDiagnosticSeverity = "info" | "warning" | "blocking";

export interface EditorDiagnostic {
  blockId: string;
  detail: string;
  id: string;
  severity: EditorDiagnosticSeverity;
  suggestion: string;
  title: string;
}

export interface EditorDiagnosticsSummary {
  blocking: number;
  info: number;
  total: number;
  warning: number;
}

const DIAGNOSTIC_BLOCK_LABELS: Partial<Record<MdxBlock["type"], string>> = {
  bookmark: "Bookmark",
  embed: "Embed",
  file: "File",
};

export function editorDiagnosticsSummary(
  diagnostics: EditorDiagnostic[],
): EditorDiagnosticsSummary {
  return diagnostics.reduce<EditorDiagnosticsSummary>(
    (summary, diagnostic) => ({
      ...summary,
      [diagnostic.severity]: summary[diagnostic.severity] + 1,
      total: summary.total + 1,
    }),
    { blocking: 0, info: 0, total: 0, warning: 0 },
  );
}

export function hasBlockingEditorDiagnostics(
  diagnostics: EditorDiagnostic[],
): boolean {
  return editorDiagnosticsSummary(diagnostics).blocking > 0;
}

export function isLikelySafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return true;
  if (/^\/(?!\/)/.test(trimmed)) return true;
  if (/^(#|\.{0,2}\/)/.test(trimmed)) return true;
  return false;
}

function collectInlineLinkDiagnostics(block: MdxBlock, out: EditorDiagnostic[]) {
  const markdownLinkRe = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of block.text.matchAll(markdownLinkRe)) {
    const href = match[1] ?? "";
    if (!isLikelySafeUrl(href)) {
      out.push({
        blockId: block.id,
        detail: href,
        id: `${block.id}:link:${out.length}`,
        severity: "blocking",
        suggestion: "Review this text block and replace the link target with https://, mailto:, tel:, /path, #anchor, ./, or ../.",
        title: "Link URL is not publishable",
      });
    }
  }
}

export function collectEditorDiagnostics(blocks: MdxBlock[]): EditorDiagnostic[] {
  const out: EditorDiagnostic[] = [];
  const visit = (block: MdxBlock) => {
    collectInlineLinkDiagnostics(block, out);
    if (block.type === "raw") {
      out.push({
        blockId: block.id,
        detail: "Raw MDX can still publish, but it is not fully WYSIWYG.",
        id: `${block.id}:raw`,
        severity: "info",
        suggestion: "Convert this block to a visual block when a supported editor exists.",
        title: "Raw MDX block",
      });
    }
    if (block.type === "image" && block.url && !block.alt?.trim()) {
      out.push({
        blockId: block.id,
        detail: block.url,
        id: `${block.id}:image-alt`,
        severity: "warning",
        suggestion: "Select the image block and add concise alt text in the inspector.",
        title: "Image is missing alt text",
      });
    }
    if (
      (block.type === "bookmark" ||
        block.type === "embed" ||
        block.type === "file") &&
      block.url &&
      !isLikelySafeUrl(block.url)
    ) {
      out.push({
        blockId: block.id,
        detail: block.url,
        id: `${block.id}:url`,
        severity: "blocking",
        suggestion: "Select this block and use a supported URL format before publishing.",
        title: `${DIAGNOSTIC_BLOCK_LABELS[block.type] ?? "Block"} URL is not publishable`,
      });
    }
    if (block.type === "page-link" && !block.pageSlug?.trim()) {
      out.push({
        blockId: block.id,
        detail: "Choose a target page slug before publishing.",
        id: `${block.id}:page-link`,
        severity: "blocking",
        suggestion: "Select the page-link block and choose a target page slug.",
        title: "Page link has no target",
      });
    }
    if (block.type === "table" && isBlockVisuallyEmpty(block)) {
      out.push({
        blockId: block.id,
        detail: "Empty table blocks are omitted when saved.",
        id: `${block.id}:table-empty`,
        severity: "info",
        suggestion: "Add table content or delete the empty table block.",
        title: "Empty table",
      });
    }
    if (
      block.type === "news-entry" &&
      !/^\d{4}-\d{2}-\d{2}$/.test(block.dateIso ?? "")
    ) {
      out.push({
        blockId: block.id,
        detail: "Use YYYY-MM-DD so the published page can sort this entry.",
        id: `${block.id}:news-date`,
        severity: "warning",
        suggestion: "Select the news entry and enter a date in YYYY-MM-DD format.",
        title: "News entry date is missing",
      });
    }
    if (
      block.type === "link-list-block" ||
      block.type === "featured-pages-block" ||
      block.type === "teaching-links" ||
      block.type === "publications-profile-links"
    ) {
      for (const [index, item] of (block.linkItems ?? []).entries()) {
        if (!item.label.trim() || !item.href.trim()) {
          out.push({
            blockId: block.id,
            detail: `Row ${index + 1} needs both label and URL.`,
            id: `${block.id}:link-item:${index}`,
            severity: "warning",
            suggestion: "Select the link block and fill both the label and URL for this row.",
            title: "Link row is incomplete",
          });
        } else if (!isLikelySafeUrl(item.href)) {
          out.push({
            blockId: block.id,
            detail: item.href,
            id: `${block.id}:link-item-url:${index}`,
            severity: "blocking",
            suggestion: "Select the link block and replace the row URL with a supported URL format.",
            title: "Link row URL is not publishable",
          });
        }
      }
    }
    for (const child of block.children ?? []) visit(child);
  };
  for (const block of blocks) visit(block);
  return out;
}
