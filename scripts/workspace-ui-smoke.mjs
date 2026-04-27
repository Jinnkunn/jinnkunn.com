#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length
    ? `\n${JSON.stringify(details, null, 2)}`
    : "";
  throw new Error(`${message}${suffix}`);
}

function assertIncludes(source, expected, label) {
  assert(source.includes(expected), `${label} missing ${expected}`);
}

function assertExcludes(source, forbidden, label) {
  assert(!source.includes(forbidden), `${label} should not include ${forbidden}`);
}

function checkInteractiveRoleKeyboard(relPath) {
  const source = read(relPath);
  const roleButtonMatches = source.match(/role=["']button["']/g) ?? [];
  if (roleButtonMatches.length === 0) return;
  assert(
    source.includes("onKeyDown") || source.includes("onKeyUp"),
    `${relPath} has role=button without a keyboard handler`,
  );
}

function main() {
  const homePanel = read("apps/workspace/src/surfaces/site-admin/HomePanel.tsx");
  assertIncludes(homePanel, "MdxDocumentEditor", "HomePanel");
  assertIncludes(homePanel, "buildHomeSource", "HomePanel");
  assertIncludes(homePanel, "parseHomeSource", "HomePanel");
  assertIncludes(homePanel, "/api/site-admin/home", "HomePanel");
  assertIncludes(homePanel, "content/home.json", "HomePanel");
  assertExcludes(homePanel, "HomeSectionRail", "HomePanel");
  assertExcludes(homePanel, "HomePreviewPane", "HomePanel");

  for (const relPath of [
    "apps/workspace/src/surfaces/site-admin/PostEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/PageEditor.tsx",
  ]) {
    const source = read(relPath);
    assertIncludes(source, "MdxDocumentEditor", relPath);
    assertIncludes(source, "MdxDocumentEditorAdapter", relPath);
    assertIncludes(source, "renderProperties", relPath);
    assertExcludes(source, "uploadImageFile", relPath);
    assertExcludes(source, "insertMarkdownImage", relPath);
  }

  const documentEditor = read("apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx");
  assertIncludes(documentEditor, "export function BlocksEditor", "MdxDocumentEditor");
  assertIncludes(documentEditor, "parseMdxBlocks", "MdxDocumentEditor");
  assertIncludes(documentEditor, "serializeMdxBlocks", "MdxDocumentEditor");
  assertIncludes(documentEditor, "application/x-mdx-block", "MdxDocumentEditor");
  assertIncludes(documentEditor, "useMdxImageUploadDrop", "MdxDocumentEditor");
  assertIncludes(documentEditor, "useUnsavedChangesBeforeUnload", "MdxDocumentEditor");
  assertIncludes(documentEditor, "useConfirmingBack", "MdxDocumentEditor");
  assertIncludes(documentEditor, "usePersistentUiState", "MdxDocumentEditor");
  assertIncludes(documentEditor, "data-controls-open", "MdxDocumentEditor");
  assertIncludes(documentEditor, "controlsActive", "MdxDocumentEditor");
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/rich-text-editable-block.tsx"),
    "mdx-document-slash-menu",
    "RichTextEditableBlock",
  );
  assertIncludes(
    read("apps/workspace/src/ui/primitives.tsx"),
    "WorkspaceSidebarRow",
    "workspace primitives",
  );
  assertIncludes(
    read("apps/workspace/src/ui/primitives.tsx"),
    "WorkspaceIconButton",
    "workspace primitives",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/block-popover.tsx"),
    "WorkspacePopover",
    "BlockPopover primitive migration",
  );
  assertIncludes(
    read("apps/workspace/src/shell/Sidebar.tsx"),
    "WorkspaceSidebarRow",
    "Sidebar primitive migration",
  );
  assertIncludes(
    read("apps/workspace/src/shell/Sidebar.tsx"),
    "WorkspaceIconButton",
    "Sidebar primitive migration",
  );
  assertIncludes(
    read("apps/workspace/src/index.css"),
    ".workspace-sidebar-row",
    "workspace primitive CSS",
  );
  assertIncludes(
    read("apps/workspace/src/index.css"),
    ".workspace-icon-button",
    "workspace primitive CSS",
  );

  const mdxBlocks = read("apps/workspace/src/surfaces/site-admin/mdx-blocks.ts");
  assertIncludes(mdxBlocks, 'type === "raw"', "mdx-blocks");
  assertIncludes(mdxBlocks, 'type === "callout"', "mdx-blocks");
  assertIncludes(mdxBlocks, 'type === "list"', "mdx-blocks");

  assertExcludes(
    read("components/posts-mdx/works-block.tsx"),
    'role="button"',
    "works static Notion toggle",
  );
  assertExcludes(
    read("components/publications/publication-list.tsx"),
    'role="button"',
    "publications static Notion toggle",
  );

  for (const relPath of [
    "apps/workspace/src/surfaces/site-admin/HomePanel.tsx",
    "apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/PostEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/PageEditor.tsx",
  ]) {
    checkInteractiveRoleKeyboard(relPath);
  }

  console.log("[workspace-ui-smoke] passed");
}

main();
