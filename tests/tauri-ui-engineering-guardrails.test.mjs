import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relPath) {
  return await fs.readFile(path.join(ROOT, relPath), "utf8");
}

test("tauri-ui-engineering: Home builder is split into maintainable panels", async () => {
  const homePanel = await read("apps/workspace/src/surfaces/site-admin/HomePanel.tsx");
  const panels = await read(
    "apps/workspace/src/surfaces/site-admin/home-builder/HomeBuilderPanels.tsx",
  );
  const previewHook = await read(
    "apps/workspace/src/surfaces/site-admin/home-builder/useHomePreview.ts",
  );

  for (const symbol of [
    "HomeSectionRail",
    "HomePreviewPane",
    "HomeEditableCanvasPane",
    "HomeInspectorShell",
    "useHomePreview",
    "usePersistentUiState",
    "HOME_EDITOR_MODES",
    "HOME_PREVIEW_VIEWPORTS",
  ]) {
    assert.match(homePanel, new RegExp(symbol), `HomePanel should use ${symbol}`);
  }

  assert.match(panels, /export function HomeSectionRail/);
  assert.match(panels, /export function HomePreviewPane/);
  assert.match(panels, /export function HomeEditableCanvasPane/);
  assert.match(panels, /export function HomeInspectorShell/);
  assert.match(panels, /HomePreviewViewport/);
  assert.match(previewHook, /api\/site-admin\/preview\/home/);
});

test("tauri-ui-engineering: Home builder defaults to canvas-first modes", async () => {
  const homePanel = await read("apps/workspace/src/surfaces/site-admin/HomePanel.tsx");
  const styles = await read("apps/workspace/src/index.css");

  assert.match(homePanel, /data-mode=\{editorMode\}/);
  assert.match(homePanel, /data-outline-open=\{outlineDrawerOpen/);
  assert.match(homePanel, /data-settings-open=\{settingsDrawerOpen/);
  assert.match(homePanel, /home-builder__outline-drawer/);
  assert.match(homePanel, /home-builder__settings-drawer/);
  // Body editing in the home canvas now uses the shared BlocksEditor
  // (Notion-style WYSIWYG) instead of the older InlineMarkdownEditor
  // textarea-with-preview wrapper. Section creation is still driven by
  // the explicit HomeInsertMenu + slash command palette below.
  assert.match(homePanel, /BlocksEditor/);
  assert.match(homePanel, /HomeInsertMenu/);
  assert.match(homePanel, /HomeSectionCommandOptions/);
  assert.match(homePanel, /BlockEditorCommandMenu/);
  assert.match(homePanel, /getMatchingBlockEditorCommands/);
  assert.match(homePanel, /HOME_SECTION_COMMANDS/);
  assert.match(styles, /\.home-builder\s*\{\s*display: grid;\s*grid-template-columns: 1fr;/s);
  assert.match(styles, /\.home-builder\[data-mode="structure"\]\s*\{\s*grid-template-columns: minmax\(300px, 0\.85fr\) minmax\(360px, 1fr\);/s);
  assert.match(styles, /\.home-canvas__section-toolbar/);
  assert.match(styles, /\.home-canvas__insert-menu/);
  assert.match(styles, /\.home-canvas__insert-popover/);
  assert.match(styles, /\.home-canvas__command-options/);
  assert.match(styles, /\.home-preview__stage/);
});

test("tauri-ui-engineering: Post and Page editors share one MDX document editor", async () => {
  const blockEditor = await read(
    "apps/workspace/src/surfaces/site-admin/block-editor.tsx",
  );
  const documentEditor = await read(
    "apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx",
  );
  const blocks = await read("apps/workspace/src/surfaces/site-admin/mdx-blocks.ts");
  const controller = await read(
    "apps/workspace/src/surfaces/site-admin/use-mdx-editor-controller.ts",
  );
  const styles = await read("apps/workspace/src/index.css");

  assert.match(documentEditor, /export function MdxDocumentEditor/);
  // BlocksEditor is the standalone block-editing canvas, exported so other
  // panels (Home, News, Teaching, Works, …) can render Notion-style blocks
  // without dragging the full document chrome.
  assert.match(documentEditor, /export function BlocksEditor/);
  assert.match(documentEditor, /parseMdxBlocks/);
  assert.match(documentEditor, /serializeMdxBlocks/);
  assert.match(documentEditor, /DOCUMENT_EDITOR_MODES/);
  assert.match(documentEditor, /mdx-document-slash-menu/);
  assert.match(documentEditor, /SLASH_COMMANDS/);
  assert.match(documentEditor, /getMatchingSlashCommands/);
  assert.match(documentEditor, /BlockEditorCommandMenu/);
  assert.match(documentEditor, /getMatchingBlockEditorCommands/);
  assert.match(documentEditor, /onInsertParagraphAfter/);
  assert.match(documentEditor, /onRemoveEmpty/);
  assert.match(documentEditor, /blockInputRefs/);
  assert.match(documentEditor, /application\/x-mdx-block/);
  assert.match(blocks, /export function parseMdxBlocks/);
  assert.match(blocks, /export function serializeMdxBlocks/);
  assert.match(blocks, /type === "raw"/);
  assert.match(blocks, /type === "callout"/);
  assert.match(blocks, /type === "list"/);
  assert.match(controller, /useMdxImageUploadDrop/);
  assert.match(controller, /useUnsavedChangesBeforeUnload/);
  assert.match(controller, /useConfirmingBack/);
  assert.match(styles, /\.mdx-document-editor__layout/);
  assert.match(styles, /\.mdx-document-block/);
  assert.match(styles, /\.mdx-document-slash-menu/);
  // Notion-style refactor: gutter handle column slimmed to 36px; slash menu
  // uses a single-column flex layout (with grouped sections + icons) instead
  // of the old 2-column grid.
  assert.match(styles, /\.mdx-document-block\s*\{[\s\S]*grid-template-columns: 36px minmax\(0, 1fr\);/);
  assert.match(styles, /\.mdx-document-slash-menu\s*\{[\s\S]*flex-direction: column;/);
  assert.match(styles, /\.block-editor-command__group-label\s*\{/);
  assert.match(blockEditor, /export interface BlockEditorCommand/);
  assert.match(blockEditor, /export function getMatchingBlockEditorCommands/);
  assert.match(blockEditor, /export function BlockEditorCommandMenu/);

  for (const relPath of [
    "apps/workspace/src/surfaces/site-admin/PostEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/PageEditor.tsx",
  ]) {
    const source = await read(relPath);
    assert.match(source, /MdxDocumentEditor/, `${relPath} should use shared editor`);
    assert.match(source, /MdxDocumentEditorAdapter/, `${relPath} should use an adapter`);
    assert.doesNotMatch(source, /uploadImageFile/, `${relPath} should not own upload flow`);
    assert.doesNotMatch(source, /MarkdownEditor/, `${relPath} should not own source editor`);
    assert.doesNotMatch(
      source,
      /insertMarkdownImage/,
      `${relPath} should not own insertion flow`,
    );
  }
});

test("tauri-ui-engineering: workspace primitives exist for future UI migration", async () => {
  const source = await read("apps/workspace/src/surfaces/site-admin/ui.tsx");
  for (const symbol of [
    "Button",
    "IconButton",
    "Field",
    "TextareaField",
    "Panel",
    "Toolbar",
    "StatusNotice",
  ]) {
    assert.match(source, new RegExp(`export function ${symbol}`));
  }
});

test("tauri-ui-engineering: static Notion toggles do not expose fake buttons", async () => {
  for (const relPath of [
    "components/works/works-view.tsx",
    "components/publications/publication-list.tsx",
  ]) {
    const source = await read(relPath);
    assert.doesNotMatch(source, /role="button"/);
    assert.doesNotMatch(source, /tabIndex=\{0\}/);
    assert.doesNotMatch(source, /aria-expanded="false"/);
  }
});

test("tauri-ui-engineering: root package exposes workspace UI smoke", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["check:workspace-ui"], "node scripts/workspace-ui-smoke.mjs");
  assert.equal(
    pkg.scripts["qa:workspace:site-admin"],
    "node scripts/workspace-site-admin-qa.mjs",
  );
  assert.equal(
    pkg.scripts["qa:workspace:site-admin:local"],
    "node scripts/workspace-site-admin-qa.mjs --local-only",
  );
  assert.equal(
    pkg.scripts["qa:workspace:site-admin:staging"],
    "node scripts/workspace-site-admin-qa.mjs --skip-workspace-build --skip-workspace-tests --skip-workspace-ui",
  );
});

test("tauri-ui-engineering: manual QA runbook covers release-critical editor flows", async () => {
  const runbook = await read("docs/runbooks/tauri-site-admin-qa.md");

  for (const phrase of [
    "Home WYSIWYG Editor",
    "Post And Page Editors",
    "Asset Library",
    "Drafts And Version History",
    "Public Preview",
    "Stop Conditions",
    "qa:workspace:site-admin:local",
    "qa:workspace:site-admin:staging",
  ]) {
    assert.match(runbook, new RegExp(phrase));
  }
});
