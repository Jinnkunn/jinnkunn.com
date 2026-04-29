import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relPath) {
  return await fs.readFile(path.join(ROOT, relPath), "utf8");
}

async function readWorkspaceCssBundle() {
  const stylesRoot = path.join(ROOT, "apps/workspace/src/styles");
  const parts = [await read("apps/workspace/src/index.css")];
  const walk = async (dir) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
        } else if (entry.isFile() && entry.name.endsWith(".css")) {
          parts.push(await fs.readFile(abs, "utf8"));
        }
      }
    } catch {
      // Split CSS directory may not exist on older branches.
    }
  };
  await walk(stylesRoot);
  return parts.join("\n");
}

test("tauri-ui-engineering: Home uses the shared MDX document editor", async () => {
  // Section-builder UI (HomeSectionRail / HomePreviewPane /
  // HomeEditableCanvasPane / HomeInspectorShell / useHomePreview / the
  // edit / structure / preview modes) was retired once the Notion-mode
  // editor became the only Home authoring surface. HomePanel is now a
  // thin adapter over the shared MdxDocumentEditor; the compatibility
  // storage remains content/home.json with { title, bodyMdx }.
  const homePanel = await read("apps/workspace/src/surfaces/site-admin/HomePanel.tsx");
  const topbar = await read("apps/workspace/src/surfaces/site-admin/SiteAdminTopBar.tsx");
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
  assert.doesNotMatch(
    homePanel,
    /PublishButton/,
    "HomePanel should not duplicate the global publish action",
  );
  assert.match(topbar, /PublishButton/, "SiteAdminTopBar should own the publish action");
  assert.match(
    topbar,
    /requirePendingChanges/,
    "Global publish action should only activate when source has pending changes",
  );

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
  const iconRegistry = await read(
    "apps/workspace/src/surfaces/site-admin/icon-link-registry.ts",
  );
  const richTextInput = await read(
    "apps/workspace/src/surfaces/site-admin/RichTextInput.tsx",
  );
  const richTextExtensions = await read(
    "apps/workspace/src/surfaces/site-admin/rich-text-extensions.ts",
  );
  const inlineLinkStyleMark = await read(
    "apps/workspace/src/surfaces/site-admin/inline-link-style-mark.ts",
  );
  const topbar = await read(
    "apps/workspace/src/surfaces/site-admin/SiteAdminTopBar.tsx",
  );
  const styles = await readWorkspaceCssBundle();

  assert.match(documentEditor, /export function MdxDocumentEditor/);
  // BlocksEditor is the standalone block-editing canvas, exported so other
  // panels (Home, News, Teaching, Works, …) can render Notion-style blocks
  // without dragging the full document chrome.
  assert.match(documentEditor, /export function BlocksEditor/);
  assert.match(documentEditor, /parseMdxBlocks/);
  assert.match(documentEditor, /serializeMdxBlocks/);
  assert.match(documentEditor, /DOCUMENT_EDITOR_MODES/);
  assert.match(
    documentEditor,
    /const DOCUMENT_EDITOR_MODES: DocumentEditorMode\[\] = \["blocks", "source"\]/,
  );
  assert.doesNotMatch(documentEditor, /usePreview/);
  assert.doesNotMatch(documentEditor, /mdx-document-editor__preview/);
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
  assert.match(richTextInput, /createRichTextExtensions/);
  assert.match(richTextExtensions, /InlineLinkStyle/);
  assert.match(inlineLinkStyleMark, /data-link-style/);
  assert.match(inlineLinkStyleMark, /data-link-icon/);
  assert.match(richTextBlock, /setInlineLinkStyle/);
  assert.match(richTextBlock, /uploadImageFile/);
  assert.match(richTextBlock, /LinkInspectorPanel/);
  assert.match(richTextBlock, /AssetLibraryPicker/);
  assert.match(richTextBlock, /findIconLinkEntryForHref/);
  assert.match(iconRegistry, /icon-link-registry\.json/);
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
  assert.match(styles, /data-link-style="icon"/);
  assert.match(
    styles,
    /\.mdx-document-text-block\.ProseMirror a,[\s\S]*background-image:/,
    "Workspace editor links should use the same Notion highlight treatment as public links",
  );
  assert.match(
    styles,
    /\.mdx-document-text-block\.ProseMirror a,[\s\S]*color: inherit;/,
    "Workspace editor links should inherit user-set text color",
  );
  assert.doesNotMatch(
    styles,
    /\.mdx-document-text-block\.ProseMirror a,[^}]*color: var\(--color-text-(?:gray|primary)\);/,
    "Workspace editor links should not force gray/black over user-set text color",
  );
  assert.match(
    styles,
    /\.mdx-document-text-block\.ProseMirror a,[^}]*opacity: 0\.7;/,
    "Workspace editor links should use the same default opacity mask as Feb 26 public links",
  );
  assert.match(
    styles,
    /span\[data-link-style="icon"\]\s*\{[\s\S]*opacity: 0\.7;/,
    "Workspace editor icon links should apply the default opacity mask to the icon slot too",
  );
  assert.doesNotMatch(
    styles,
    /span\[data-link-style="icon"\]\s+a\s*\{[^}]*font-weight:/,
    "Workspace editor icon links should not override user-set bold marks",
  );
  assert.match(
    styles,
    /span\[data-link-style="icon"\] > a\.notion-link\.link,\s*\na\[data-link-style="icon"\]\.notion-link\.link/,
    "Workspace preview icon links should only add the icon slot to Notion links",
  );
  assert.doesNotMatch(
    styles,
    /\.mdx-document-text-block\.ProseMirror a\s*\{\s*color: var\(--color-accent\)/,
    "Workspace editor links should not use a separate accent-link style",
  );
  // Notion-style refactor: gutter handles live outside the content column
  // and reveal only on hover/focus/menu-open, so controls no longer compress
  // the editable text.
  assert.match(styles, /\.mdx-document-blocks\s*\{[\s\S]*padding: 2px 0;/);
  assert.match(styles, /--mdx-block-gutter/);
  assert.match(styles, /\.mdx-document-block\s*\{[\s\S]*display: block;/);
  assert.match(styles, /\.mdx-document-block__gutter\s*\{[\s\S]*position: absolute;/);
  assert.match(styles, /\.mdx-document-block\[data-controls-open="true"\] \.mdx-document-block__gutter/);
  assert.match(styles, /\.mdx-document-slash-menu\s*\{[\s\S]*flex-direction: column;/);
  assert.match(styles, /\.block-editor-command__group-label\s*\{/);
  assert.match(blockEditor, /export interface BlockEditorCommand/);
  assert.match(blockEditor, /export function getMatchingBlockEditorCommands/);
  assert.match(blockEditor, /export function BlockEditorCommandMenu/);
  assert.match(topbar, /handleWindowDragMouseDown/);
  assert.match(topbar, /data-tauri-drag-region/);
  assert.doesNotMatch(richTextBlock, /aria-label="Heading level"/);
  assert.doesNotMatch(richTextBlock, /aria-label="List style"/);

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

test("tauri-ui-engineering: shared content editor stays visual-first", async () => {
  const componentEditor = await read(
    "apps/workspace/src/surfaces/site-admin/ComponentEditor.tsx",
  );
  const blockRenderers = await read(
    "apps/workspace/src/surfaces/site-admin/mdx-block-renderers.tsx",
  );
  const previewRoute = await read(
    "app/api/site-admin/components/[name]/preview/route.ts",
  );

  assert.match(componentEditor, /component-collection-table/);
  assert.match(componentEditor, /component-embed-preview/);
  assert.match(componentEditor, /ENABLE_COMPONENT_COLLECTION_TABLE = false/);
  assert.match(componentEditor, /\/api\/site-admin\/components\/\$\{encodeURIComponent\(name\)\}\/preview/);
  assert.match(previewRoute, /renderComponentPreviewElement/);
  assert.match(blockRenderers, /More details/);
  assert.doesNotMatch(blockRenderers, /JSON array/);
  assert.doesNotMatch(blockRenderers, /authorsRich \(JSON/);
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

test("tauri-ui-engineering: publish surfaces stale staging candidates as a rebuild step", async () => {
  const publishButton = await read(
    "apps/workspace/src/surfaces/site-admin/PublishButton.tsx",
  );
  const statusPanel = await read("apps/workspace/src/surfaces/site-admin/StatusPanel.tsx");
  const releasePanel = await read("apps/workspace/src/surfaces/site-admin/ReleasePanel.tsx");
  const pipeline = await read(
    "apps/workspace/src/surfaces/site-admin/PublishPipelineCard.tsx",
  );

  assert.match(publishButton, /isDeployCandidateBlocked/);
  assert.match(publishButton, /DEPLOY_VERSION_STALE/);
  assert.match(publishButton, /GitHub Actions “Deploy \(auto\)”/);
  assert.match(publishButton, /npm run release:staging/);
  assert.match(publishButton, /Recheck/);
  assert.doesNotMatch(
    publishButton,
    /Publish failed: \$\{response\.code\}: \$\{response\.error\}[\s\S]*DEPLOY_VERSION_STALE/,
    "DEPLOY_VERSION_STALE should be translated into a rebuild/recheck message, not shown as a raw failure",
  );
  assert.match(statusPanel, /GitHub Actions “Deploy \(auto\)”/);
  assert.match(statusPanel, /npm run release:staging/);
  assert.match(statusPanel, /PublishPipelineCard/);
  assert.match(statusPanel, /Content source/);
  assert.match(statusPanel, /Next action/);
  assert.match(statusPanel, /D1 content database/);
  assert.match(statusPanel, /Release Health/);
  assert.match(statusPanel, /Site sync and release health/);
  assert.match(statusPanel, /Active deploy/);
  assert.match(statusPanel, /Latest upload/);
  assert.match(statusPanel, /Latest Uploaded Version/);
  assert.match(pipeline, /Saved source/);
  assert.match(pipeline, /Worker candidate/);
  assert.match(pipeline, /Staging deploy/);
  assert.match(pipeline, /Production promotion remains explicit/);
  assert.match(pipeline, /D1 source has no branch diff/);
  assert.match(releasePanel, /PROMOTE_STAGING_CONTENT=1 npm run release:prod/);
  assert.match(releasePanel, /Copy Production Command/);
  assert.match(releasePanel, /Production promotion starts from Staging/);
  assert.match(releasePanel, /Promotion Checklist/);
});

test("tauri-ui-engineering: production settings are visibly locked", async () => {
  const configPanel = await fs.readFile(
    path.join(process.cwd(), "apps/workspace/src/surfaces/site-admin/ConfigPanel.tsx"),
    "utf8",
  );
  const workspaceCss = await fs.readFile(
    path.join(process.cwd(), "apps/workspace/src/styles/surfaces/site-admin-content.css"),
    "utf8",
  );
  assert.match(configPanel, /Read-only in Production/);
  assert.match(configPanel, /Production settings are locked in Workspace/);
  assert.match(configPanel, /settings-readonly-callout/);
  assert.match(workspaceCss, /\.settings-readonly-callout/);
});

test("tauri-ui-engineering: link audit is a first-class Site Admin surface", async () => {
  const types = await read("apps/workspace/src/surfaces/site-admin/types.ts");
  const nav = await read("apps/workspace/src/surfaces/site-admin/nav.tsx");
  const surface = await read("apps/workspace/src/surfaces/site-admin/SiteAdminSurface.tsx");
  const commandPalette = await read(
    "apps/workspace/src/shell/WorkspaceCommandPalette.tsx",
  );
  const linkAudit = await read(
    "apps/workspace/src/surfaces/site-admin/LinkAuditPanel.tsx",
  );

  assert.match(types, /\| "links"/);
  assert.match(nav, /id: "links"/);
  assert.match(surface, /LinkAuditPanel/);
  assert.match(commandPalette, /Open Link Audit/);
  assert.match(linkAudit, /missing-icon-mark/);
  assert.match(linkAudit, /folder-only/);
  assert.match(linkAudit, /localContent\.syncPull/);
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
