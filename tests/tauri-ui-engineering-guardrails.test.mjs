import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relPath) {
  return await fs.readFile(path.join(ROOT, relPath), "utf8");
}

test("tauri-ui-engineering: Home uses the shared MDX document editor", async () => {
  // Section-builder UI (HomeSectionRail / HomePreviewPane /
  // HomeEditableCanvasPane / HomeInspectorShell / useHomePreview / the
  // edit / structure / preview modes) was retired once the Notion-mode
  // editor became the only Home authoring surface. HomePanel is now a
  // thin adapter over the shared MdxDocumentEditor; the compatibility
  // storage remains content/home.json with { title, bodyMdx }.
  const homePanel = await read("apps/workspace/src/surfaces/site-admin/HomePanel.tsx");
  const schema = await read(
    "apps/workspace/src/surfaces/site-admin/home-builder/schema.ts",
  );

  // What HomePanel SHOULD use: the shared document editor and the
  // frontmatter helpers that translate title/bodyMdx to an editor source.
  for (const symbol of [
    "MdxDocumentEditor",
    "MdxDocumentEditorAdapter",
    "buildHomeSource",
    "parseHomeSource",
    "/api/site-admin/home",
    "content/home.json",
  ]) {
    assert.match(homePanel, new RegExp(symbol), `HomePanel should use ${symbol}`);
  }

  // What HomePanel must NOT reference anymore (the deleted
  // section-builder primitives). These would all `import` from files
  // that no longer exist, so even compile would fail — but assert
  // explicitly so a future revival is caught here first.
  for (const banned of [
    "HomeSectionRail",
    "HomePreviewPane",
    "HomeEditableCanvasPane",
    "HomeInspectorShell",
    "useHomePreview",
    "HomeInsertMenu",
    "HOME_EDITOR_MODES",
    "HOME_PREVIEW_VIEWPORTS",
  ]) {
    assert.doesNotMatch(
      homePanel,
      new RegExp(banned),
      `HomePanel should no longer reference ${banned}`,
    );
  }

  // Schema is the slimmed `{ title, bodyMdx }` shape.
  assert.match(schema, /export function normalizeHomeData/);
  assert.match(schema, /export function prepareHomeDataForSave/);
  assert.doesNotMatch(schema, /HomeSectionType|createSection|sectionTitle/);
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
  // The TipTap-backed editor for paragraph / heading / quote / callout /
  // list blocks. Owns the slash menu rendering since the textarea path
  // no longer handles any block whose text starts with "/".
  const richTextBlock = await read(
    "apps/workspace/src/surfaces/site-admin/rich-text-editable-block.tsx",
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
  assert.match(documentEditor, /SLASH_COMMANDS/);
  assert.match(documentEditor, /getMatchingSlashCommands/);
  assert.match(documentEditor, /getMatchingBlockEditorCommands/);
  assert.match(documentEditor, /onInsertParagraphAfter/);
  assert.match(documentEditor, /onRemoveEmpty/);
  assert.match(documentEditor, /blockInputRefs/);
  assert.match(documentEditor, /application\/x-mdx-block/);
  // Slash-menu rendering moved into the per-block TipTap component when
  // paragraph migrated off the textarea. The dispatcher still owns
  // SLASH_COMMANDS + matching, but the menu element + className are
  // emitted from RichTextEditableBlock.
  assert.match(richTextBlock, /BlockEditorCommandMenu/);
  assert.match(richTextBlock, /mdx-document-slash-menu/);
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
  // works rendering moved to a generic MDX block; the markup that used
  // to live in works-view.tsx is now in works-block.tsx.
  for (const relPath of [
    "components/posts-mdx/works-block.tsx",
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
