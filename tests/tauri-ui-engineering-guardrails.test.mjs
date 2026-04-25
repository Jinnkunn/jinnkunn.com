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
  assert.match(homePanel, /InlineMarkdownEditor/);
  assert.match(styles, /\.home-builder\s*\{\s*display: grid;\s*grid-template-columns: 1fr;/s);
  assert.match(styles, /\.home-builder\[data-mode="structure"\]\s*\{\s*grid-template-columns: minmax\(300px, 0\.85fr\) minmax\(360px, 1fr\);/s);
  assert.match(styles, /\.home-canvas__section-toolbar/);
  assert.match(styles, /\.home-canvas__insert-row/);
  assert.match(styles, /\.home-canvas__markdown-preview/);
  assert.match(styles, /\.home-preview__stage/);
});

test("tauri-ui-engineering: Post and Page editors share one MDX document editor", async () => {
  const documentEditor = await read(
    "apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx",
  );
  const blocks = await read("apps/workspace/src/surfaces/site-admin/mdx-blocks.ts");
  const controller = await read(
    "apps/workspace/src/surfaces/site-admin/use-mdx-editor-controller.ts",
  );
  const styles = await read("apps/workspace/src/index.css");

  assert.match(documentEditor, /export function MdxDocumentEditor/);
  assert.match(documentEditor, /function BodyBlockCanvas/);
  assert.match(documentEditor, /parseMdxBlocks/);
  assert.match(documentEditor, /serializeMdxBlocks/);
  assert.match(documentEditor, /DOCUMENT_EDITOR_MODES/);
  assert.match(documentEditor, /mdx-document-slash-menu/);
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
});
