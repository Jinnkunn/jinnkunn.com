#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function readWorkspaceCssBundle() {
  const stylesRoot = path.join(ROOT, "apps/workspace/src/styles");
  const parts = [read("apps/workspace/src/index.css")];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith(".css")) {
        parts.push(fs.readFileSync(abs, "utf8"));
      }
    }
  };
  walk(stylesRoot);
  return parts.join("\n");
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
  assertIncludes(documentEditor, "data-kind", "MdxDocumentEditor block semantics");
  assertIncludes(documentEditor, "data-empty", "MdxDocumentEditor block semantics");
  assertIncludes(documentEditor, "productionReadOnly", "MdxDocumentEditor production read-only");
  assertIncludes(documentEditor, "data-read-only", "MdxDocumentEditor read-only state");
  assertIncludes(documentEditor, "readOnly={productionReadOnly}", "MdxDocumentEditor read-only fields");
  assertIncludes(documentEditor, "isBlockVisuallyEmpty", "MdxDocumentEditor block semantics");
  assertIncludes(documentEditor, "controlsActive", "MdxDocumentEditor");
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/state.tsx"),
    "getSiteAdminEnvironment",
    "Site Admin environment mode",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/SiteAdminTopBar.tsx"),
    "site-admin-topbar__environment",
    "Site Admin environment badge",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/SiteAdminConnectionPill.tsx"),
    "site-admin-pill__environment",
    "Site Admin connection environment summary",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/SiteAdminEnvironmentBanner.tsx"),
    "Switch to Staging",
    "Site Admin production recovery banner",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/PublishButton.tsx"),
    "Open Deploy Action",
    "Publish stale candidate recovery",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/StatusPanel.tsx"),
    "Copy release command",
    "Status stale candidate recovery",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/use-editor-draft.ts"),
    "saveDraftNow",
    "Editor conflict draft preservation",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/rich-text-editable-block.tsx"),
    "data-empty",
    "RichTextEditableBlock empty-state semantics",
  );
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
    read("apps/workspace/src/ui/primitives.tsx"),
    "WorkspaceMain",
    "workspace primitives",
  );
  assertIncludes(
    read("apps/workspace/src/ui/primitives.tsx"),
    "WorkspaceSurfaceFrame",
    "workspace primitives",
  );
  assertIncludes(
    read("apps/workspace/src/ui/primitives.tsx"),
    "WorkspaceInspector",
    "workspace primitives",
  );
  assertIncludes(
    read("apps/workspace/src/ui/primitives.tsx"),
    "WorkspaceInspectorSection",
    "workspace primitives",
  );
  assertIncludes(
    read("apps/workspace/src/ui/primitives.tsx"),
    "WorkspaceSelectField",
    "workspace primitives",
  );
  assertIncludes(
    read("apps/workspace/src/ui/primitives.tsx"),
    "WorkspaceCheckboxField",
    "workspace primitives",
  );
  assertIncludes(
    read("apps/workspace/src/App.tsx"),
    "WorkspaceMain",
    "App shell primitive migration",
  );
  assertIncludes(
    read("apps/workspace/src/App.tsx"),
    "WorkspaceCommandPalette",
    "App global command palette",
  );
  assertIncludes(
    read("apps/workspace/src/App.tsx"),
    "touchRecentItem",
    "App recent navigation tracking",
  );
  assertIncludes(
    read("apps/workspace/src/shell/WorkspaceCommandPalette.tsx"),
    "command-palette--workspace",
    "Workspace command palette",
  );
  assertIncludes(
    read("apps/workspace/src/shell/Titlebar.tsx"),
    "workspace-status-center",
    "Workspace status center",
  );
  assertIncludes(
    read("apps/workspace/src/shell/recent.ts"),
    "workspace.sidebar.recent.v1",
    "Workspace recent navigation storage",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/SiteAdminSurface.tsx"),
    "WorkspaceSurfaceFrame",
    "Site Admin surface primitive migration",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/calendar/CalendarSurface.tsx"),
    "WorkspaceSurfaceFrame",
    "Calendar surface primitive migration",
  );
  assertIncludes(
    documentEditor,
    "WorkspaceInspector",
    "MdxDocumentEditor inspector primitive migration",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/PageEditor.tsx"),
    "WorkspaceInspectorSection",
    "Page properties inspector sections",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/PostEditor.tsx"),
    "WorkspaceInspectorSection",
    "Post properties inspector sections",
  );
  for (const relPath of [
    "apps/workspace/src/surfaces/site-admin/HomePanel.tsx",
    "apps/workspace/src/surfaces/site-admin/PageEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/PostEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/page-routing-properties.tsx",
    "apps/workspace/src/surfaces/site-admin/page-seo-properties.tsx",
  ]) {
    const source = read(relPath);
    assertExcludes(source, "home-builder__field", relPath);
    assertExcludes(source, "home-builder__toggle", relPath);
  }
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx"),
    "workspace-inspector__meta",
    "MdxDocumentEditor inspector status metadata",
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
    read("apps/workspace/src/shell/Sidebar.tsx"),
    "sidebar-app-rail",
    "Sidebar app rail migration",
  );
  assertIncludes(
    read("apps/workspace/src/shell/Sidebar.tsx"),
    "sidebar-context-pane",
    "Sidebar context pane migration",
  );
  assertIncludes(
    read("apps/workspace/src/shell/Sidebar.tsx"),
    "sidebar-recent",
    "Sidebar recent navigation",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/block-editor.tsx"),
    "activeCommandId",
    "Block command menu keyboard active state",
  );
  const workspaceCss = readWorkspaceCssBundle();
  assertIncludes(
    workspaceCss,
    ".workspace-sidebar-row",
    "workspace primitive CSS",
  );
  assertIncludes(
    workspaceCss,
    ".workspace-icon-button",
    "workspace primitive CSS",
  );
  assertIncludes(
    workspaceCss,
    ".workspace-inspector",
    "workspace inspector CSS",
  );
  assertIncludes(
    workspaceCss,
    ".workspace-checkbox-field",
    "workspace form primitive CSS",
  );
  assertIncludes(
    workspaceCss,
    ".workspace-inspector__meta",
    "workspace inspector metadata CSS",
  );
  assertIncludes(
    workspaceCss,
    "--mdx-block-gutter",
    "workspace editor low-interference block gutter",
  );
  assertIncludes(
    workspaceCss,
    "pointer-events: none",
    "workspace editor low-interference block gutter",
  );
  assertIncludes(
    workspaceCss,
    ".mdx-document-block[data-empty=\"true\"]:hover",
    "workspace editor empty block hover placeholder",
  );
  assertIncludes(
    workspaceCss,
    ".sidebar-app-rail",
    "workspace sidebar shell CSS",
  );
  assertIncludes(
    workspaceCss,
    ".sidebar-context-pane",
    "workspace sidebar shell CSS",
  );
  assertIncludes(
    workspaceCss,
    ".workspace-status-center",
    "workspace status center CSS",
  );
  assertIncludes(
    workspaceCss,
    ".command-palette--workspace",
    "workspace command palette CSS",
  );
  assertIncludes(
    workspaceCss,
    ".sidebar-recent",
    "workspace recent navigation CSS",
  );
  assertIncludes(
    workspaceCss,
    ".mdx-document-slash-menu button[data-active=\"true\"]",
    "workspace editor slash menu active state CSS",
  );
  assertIncludes(
    workspaceCss,
    ".site-admin-topbar__environment[data-kind=\"production\"]",
    "Site Admin production environment badge CSS",
  );
  assertIncludes(
    workspaceCss,
    ".site-admin-pill__mode[data-kind=\"production\"]",
    "Site Admin production connection mode CSS",
  );
  assertIncludes(
    workspaceCss,
    ".mdx-document-editor[data-read-only=\"true\"]",
    "MdxDocumentEditor read-only CSS",
  );
  assertIncludes(
    workspaceCss,
    ".site-admin-environment-banner",
    "Site Admin production recovery banner CSS",
  );
  assertIncludes(
    workspaceCss,
    ".site-admin-recovery-card",
    "Site Admin stale candidate recovery CSS",
  );
  assertIncludes(
    workspaceCss,
    ".publish-preview__recovery",
    "Publish stale candidate recovery CSS",
  );
  for (const token of [
    "--workspace-sidebar-rail-width",
    "--workspace-sidebar-top-overlap",
    "--workspace-traffic-light-strip-height",
    "--workspace-traffic-light-clearance",
    "--workspace-sidebar-depth-step",
  ]) {
    assertIncludes(workspaceCss, token, "workspace shell layout tokens");
  }

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
