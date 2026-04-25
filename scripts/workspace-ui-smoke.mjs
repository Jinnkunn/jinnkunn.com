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
  assertIncludes(homePanel, "useHomePreview", "HomePanel");
  assertIncludes(homePanel, "HomeSectionRail", "HomePanel");
  assertIncludes(homePanel, "HomePreviewPane", "HomePanel");
  assertIncludes(homePanel, "HomeInspectorShell", "HomePanel");
  assertIncludes(homePanel, "usePersistentUiState", "HomePanel");

  const homePanels = read(
    "apps/workspace/src/surfaces/site-admin/home-builder/HomeBuilderPanels.tsx",
  );
  assertIncludes(homePanels, "export function HomeSectionRail", "HomeBuilderPanels");
  assertIncludes(homePanels, "export function HomePreviewPane", "HomeBuilderPanels");
  assertIncludes(homePanels, "export function HomeInspectorShell", "HomeBuilderPanels");
  assertIncludes(homePanels, "IconButton", "HomeBuilderPanels");

  for (const relPath of [
    "apps/workspace/src/surfaces/site-admin/PostEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/PageEditor.tsx",
  ]) {
    const source = read(relPath);
    assertIncludes(source, "useMdxImageUploadDrop", relPath);
    assertIncludes(source, "useUnsavedChangesBeforeUnload", relPath);
    assertIncludes(source, "useConfirmingBack", relPath);
    assertIncludes(source, "usePersistentUiState", relPath);
    assertExcludes(source, "uploadImageFile", relPath);
    assertExcludes(source, "insertMarkdownImage", relPath);
  }

  assertExcludes(
    read("components/works/works-view.tsx"),
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
    "apps/workspace/src/surfaces/site-admin/home-builder/HomeBuilderPanels.tsx",
    "apps/workspace/src/surfaces/site-admin/PostEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/PageEditor.tsx",
  ]) {
    checkInteractiveRoleKeyboard(relPath);
  }

  console.log("[workspace-ui-smoke] passed");
}

main();
