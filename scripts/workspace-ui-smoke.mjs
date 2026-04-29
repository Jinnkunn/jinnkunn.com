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
  const blockInspector = read("apps/workspace/src/surfaces/site-admin/block-inspector.tsx");
  assertIncludes(documentEditor, "export function BlocksEditor", "MdxDocumentEditor");
  assertIncludes(documentEditor, "parseMdxBlocks", "MdxDocumentEditor");
  assertIncludes(documentEditor, "serializeMdxBlocks", "MdxDocumentEditor");
  assertIncludes(documentEditor, "application/x-mdx-block", "MdxDocumentEditor");
  assertIncludes(documentEditor, "useMdxImageUploadDrop", "MdxDocumentEditor");
  assertIncludes(documentEditor, "useUnsavedChangesBeforeUnload", "MdxDocumentEditor");
  assertIncludes(documentEditor, "useConfirmingBack", "MdxDocumentEditor");
  assertIncludes(documentEditor, "usePersistentUiState", "MdxDocumentEditor");
  assertIncludes(documentEditor, "BlockInspector", "MdxDocumentEditor block inspector");
  assertExcludes(documentEditor, "function BlockInspector", "MdxDocumentEditor inline block inspector");
  assertIncludes(blockInspector, "export function BlockInspector", "BlockInspector module");
  assertIncludes(blockInspector, "export function blockHasInspector", "BlockInspector module");
  assertIncludes(blockInspector, "function TableInspector", "BlockInspector table controls");
  assertIncludes(blockInspector, "Teaching links", "BlockInspector link strip controls");
  assertIncludes(documentEditor, "data-selected", "MdxDocumentEditor block selection");
  assertIncludes(documentEditor, "Raw MDX fallback", "MdxDocumentEditor raw fallback");
  assertIncludes(documentEditor, "RECENT_SLASH_COMMAND_IDS_KEY", "MdxDocumentEditor slash recents");
  assertIncludes(documentEditor, 'source: "Advanced"', "MdxDocumentEditor advanced mode label");
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
    "SiteAdminConnectionPill",
    "Site Admin topbar should use the connection/environment control",
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
    "workflowRecovery.openLabel",
    "Publish stale candidate recovery",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/PublishPipelineCard.tsx"),
    "workflow.copyLabel",
    "Status stale candidate recovery",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/StatusPanel.tsx"),
    "status-readiness",
    "Status readiness summary",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/release-flow-model.ts"),
    "D1 content database",
    "Status source clarity",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/StatusPanel.tsx"),
    "Release Health",
    "Status release health panel",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/StatusPanel.tsx"),
    "Active deploy",
    "Status active deploy version",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/StatusPanel.tsx"),
    "Latest Uploaded Version",
    "Status latest upload version",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/ReleasePanel.tsx"),
    "RELEASE_PROD_FROM_STAGING_COMMAND",
    "Release panel routine production promotion command",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/ReleasePanel.tsx"),
    "LEGACY_RELEASE_PROD_COMMAND",
    "Release panel legacy fallback command",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/ReleasePanel.tsx"),
    "PromoteToProductionButton",
    "Release panel promotion action",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/ReleasePanel.tsx"),
    "Advanced command fallback",
    "Release panel command fallback",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/ReleasePanel.tsx"),
    "Environment comparison",
    "Release panel staging/production comparison",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/SiteAdminTopBar.tsx"),
    "topbarSaveAction",
    "Site Admin topbar save action",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx"),
    "setTopbarSaveAction",
    "MDX editor registers topbar save",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/ConfigPanel.tsx"),
    "Read-only in Production",
    "Production settings lock",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/use-editor-draft.ts"),
    "saveDraftNow",
    "Editor conflict draft preservation",
  );
  assertIncludes(
    read("lib/server/content-files.ts"),
    "content\", \"local",
    "Local content override roots",
  );
  assertIncludes(
    read("scripts/release-cloudflare.mjs"),
    "ALLOW_DIRTY_STAGING",
    "Staging dirty guard",
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
    read("apps/workspace/src/surfaces/site-admin/rich-text-editable-block.tsx"),
    "LinkInspectorPanel",
    "RichTextEditableBlock link inspector",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/rich-text-editable-block.tsx"),
    "markdownShortcutBlock",
    "RichTextEditableBlock markdown shortcuts",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/rich-text-editable-block.tsx"),
    "shouldPromotePlainTextPaste",
    "RichTextEditableBlock paste import",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx"),
    "EditorDiagnosticsPanel",
    "MdxDocumentEditor diagnostics",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/mdx-block-renderers.tsx"),
    "LinkItemsInlineEditor",
    "structured block inline editing",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/icon-link-registry.ts"),
    "icon-link-registry.json",
    "shared icon link registry",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/LinkAuditPanel.tsx"),
    "missing-icon-mark",
    "Link audit known icon detection",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/SiteAdminSurface.tsx"),
    "LinkAuditPanel",
    "Site Admin link audit surface",
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
    "WorkspaceDashboard",
    "App workspace dashboard",
  );
  assertIncludes(
    read("apps/workspace/src/App.tsx"),
    "loadWorkspaceEvents",
    "App workspace event center",
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
    read("apps/workspace/src/shell/WorkspaceCommandPalette.tsx"),
    "Quick Actions",
    "Workspace command palette quick actions",
  );
  assertIncludes(
    read("apps/workspace/src/shell/WorkspaceCommandPalette.tsx"),
    "Clear Workspace Activity",
    "Workspace command palette activity command",
  );
  assertIncludes(
    read("apps/workspace/src/shell/Titlebar.tsx"),
    "workspace-status-center",
    "Workspace status center",
  );
  assertIncludes(
    read("apps/workspace/src/shell/Titlebar.tsx"),
    "workspace-status-center__event",
    "Workspace activity center",
  );
  assertIncludes(
    read("apps/workspace/src/shell/WorkspaceDashboard.tsx"),
    "workspace-dashboard__action-grid",
    "Workspace dashboard action grid",
  );
  assertIncludes(
    read("apps/workspace/src/shell/WorkspaceDashboard.tsx"),
    "workspace-dashboard__text-button",
    "Workspace dashboard activity clear action",
  );
  assertIncludes(
    read("apps/workspace/src/shell/workspaceEvents.ts"),
    "workspace.events.v1",
    "Workspace event persistence",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/site-admin/state.tsx"),
    "emitWorkspaceEvent",
    "Site Admin emits workspace activity",
  );
  assertIncludes(
    read("apps/workspace/src/surfaces/registry.tsx"),
    'id: "workspace"',
    "Workspace dashboard registry entry",
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
    ".mdx-block-inspector",
    "workspace editor block inspector",
  );
  assertIncludes(
    workspaceCss,
    ".mdx-block-inspector__table",
    "workspace editor block inspector table controls",
  );
  assertIncludes(
    workspaceCss,
    ".mdx-document-data-block__meta",
    "workspace editor visual data-source block",
  );
  assertIncludes(
    workspaceCss,
    ".mdx-block-editor-shell",
    "workspace editor block inspector shell",
  );
  assertIncludes(
    workspaceCss,
    ".mdx-document-block[data-selected=\"true\"]",
    "workspace editor block selection CSS",
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
    ".workspace-status-center__event",
    "workspace activity center CSS",
  );
  assertIncludes(
    workspaceCss,
    ".workspace-dashboard",
    "workspace dashboard CSS",
  );
  assertIncludes(
    workspaceCss,
    ".workspace-activity-list",
    "workspace activity list CSS",
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
    ".mdx-document-diagnostics",
    "workspace editor diagnostics CSS",
  );
  assertIncludes(
    workspaceCss,
    ".site-admin-pill__mode[data-kind=\"production\"]",
    "Site Admin production environment mode CSS",
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
    ".publish-preview__recovery",
    "Publish stale candidate recovery CSS",
  );
  assertIncludes(
    workspaceCss,
    ".publish-pipeline",
    "Publish pipeline CSS",
  );
  assertIncludes(
    workspaceCss,
    ".status-readiness",
    "Status readiness CSS",
  );
  assertIncludes(
    workspaceCss,
    ".release-health",
    "Release health CSS",
  );
  assertIncludes(
    workspaceCss,
    ".settings-readonly-callout",
    "Production settings lock CSS",
  );
  assertIncludes(
    workspaceCss,
    ".link-audit__table",
    "Link audit CSS",
  );
  assertIncludes(
    workspaceCss,
    ".mdx-link-inspector",
    "Link inspector CSS",
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
