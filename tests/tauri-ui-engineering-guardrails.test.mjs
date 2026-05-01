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
  // Phase: BlocksEditor + its block-editing canvas + helpers (EditableBlocksList,
  // EditableBlock, CodeOrRawTextarea) live in their own file so surfaces that
  // just need the canvas (Notes) don't pull in the document chrome.
  const blocksEditor = await read(
    "apps/workspace/src/surfaces/site-admin/blocks-editor.tsx",
  );
  const blockInspector = await read(
    "apps/workspace/src/surfaces/site-admin/block-inspector.tsx",
  );
  const editorSlashCommands = await read(
    "apps/workspace/src/surfaces/site-admin/editor-slash-commands.ts",
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
  // BlocksEditor is the standalone block-editing canvas — now in
  // blocks-editor.tsx so Notes can lazy-load it without the full
  // document chrome. MdxDocumentEditor.tsx still re-exports it for
  // backward compat with existing imports.
  assert.match(blocksEditor, /export function BlocksEditor/);
  assert.match(documentEditor, /BlocksEditor,/);
  assert.match(blocksEditor, /parseMdxBlocks/);
  assert.match(blocksEditor, /serializeMdxBlocks/);
  assert.match(documentEditor, /DOCUMENT_EDITOR_MODES/);
  assert.match(
    documentEditor,
    /const DOCUMENT_EDITOR_MODES: DocumentEditorMode\[\] = \["blocks", "source"\]/,
  );
  assert.match(documentEditor, /source: "Advanced"/);
  assert.doesNotMatch(documentEditor, /usePreview/);
  assert.doesNotMatch(documentEditor, /mdx-document-editor__preview/);
  assert.match(editorSlashCommands, /SLASH_COMMANDS/);
  assert.match(editorSlashCommands, /RECENT_SLASH_COMMAND_IDS_KEY/);
  assert.match(editorSlashCommands, /rememberRecentSlashCommand/);
  assert.match(editorSlashCommands, /getMatchingSlashCommands/);
  assert.match(editorSlashCommands, /getMatchingBlockEditorCommands/);
  assert.match(blocksEditor, /onInsertParagraphAfter/);
  assert.match(blocksEditor, /onRemoveEmpty/);
  assert.match(blocksEditor, /blockInputRefs/);
  assert.match(blocksEditor, /application\/x-mdx-block/);
  assert.match(blocksEditor, /BlockInspector, blockHasInspector/);
  assert.doesNotMatch(blocksEditor, /function BlockInspector/);
  assert.match(blockInspector, /export function BlockInspector/);
  assert.match(blockInspector, /export function blockHasInspector/);
  assert.match(blockInspector, /function TableInspector/);
  assert.match(blockInspector, /Upload file/);
  assert.match(blockInspector, /Page link/);
  assert.match(blockInspector, /Teaching links/);
  assert.match(blockInspector, /publications-profile-links/);
  assert.match(blocksEditor, /data-selected/);
  assert.match(blocksEditor, /Raw MDX fallback/);
  assert.match(documentEditor, /rawBlockCount/);
  assert.match(blocksEditor, /EditorDiagnosticsPanel/);
  assert.match(blocksEditor, /collectEditorDiagnostics/);
  assert.match(blocksEditor, /onReplaceWithBlocks/);
  // Notes-isolation contract: blocks-editor must not pull in site-admin
  // state hooks. The base ProseMirror canvas should be reusable from any
  // surface via the WorkspaceEditorRuntime context.
  assert.doesNotMatch(blocksEditor, /\buseSiteAdmin\s*\(/);
  assert.doesNotMatch(
    blocksEditor,
    /from\s+["'][^"']*\.\/state["']/,
  );
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
  assert.match(richTextBlock, /markdownShortcutBlock/);
  assert.match(richTextBlock, /shouldPromotePlainTextPaste/);
  assert.match(richTextBlock, /onPaste/);
  assert.doesNotMatch(richTextBlock, /window\.prompt\("Link URL"/);
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
  assert.match(styles, /\.mdx-document-diagnostics/);
  assert.match(styles, /\.mdx-document-slash-menu/);
  assert.match(documentEditor, /mdx-document-editor__title workspace-editor-title-input/);
  assert.match(styles, /\.workspace-editor-title-input\s*\{[\s\S]*overflow: visible;/);
  assert.match(
    styles,
    /\.workspace-editor-title-input\s*\{[\s\S]*line-height: var\(--workspace-editor-title-line-height, 1\.35\);/,
    "Workspace title inputs should share the WebKit clipping-safe title metric",
  );
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
  assert.match(styles, /\.mdx-block-editor-shell/);
  assert.match(styles, /\.mdx-block-inspector/);
  assert.match(styles, /\.mdx-block-inspector__table/);
  assert.match(styles, /\.mdx-document-data-block__meta/);
  assert.match(styles, /\.mdx-document-block\[data-selected="true"\]/);
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
  const primitives = await read("apps/workspace/src/ui/primitives.tsx");
  const workspacePkg = JSON.parse(await read("apps/workspace/package.json"));
  const surfaceIcons = await read("apps/workspace/src/surfaces/icons.tsx");
  const shellSidebar = await read("apps/workspace/src/shell/Sidebar.tsx");
  const styles = await readWorkspaceCssBundle();
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
  for (const symbol of [
    "WorkspaceCommandBar",
    "WorkspaceCommandGroup",
    "WorkspaceCommandButton",
    "WorkspaceSplitView",
    "WorkspacePane",
    "WorkspaceSheet",
    "WorkspaceBottomSheet",
    "WorkspaceActionMenu",
    "WorkspaceSegmentedControl",
  ]) {
    assert.match(primitives, new RegExp(`export function ${symbol}`));
  }
  for (const selector of [
    ".workspace-commandbar",
    ".workspace-commandbar__group",
    ".workspace-commandbar__button",
    ".workspace-split-view",
    ".workspace-split-view__inspector",
    ".workspace-sheet",
    ".workspace-action-menu",
    ".workspace-segmented-control",
    "@media (max-width: 720px)",
  ]) {
    assert.match(styles, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.ok(
    workspacePkg.dependencies["lucide-react"],
    "Workspace app should use lucide-react as the shared maintained icon library",
  );
  assert.match(surfaceIcons, /from "lucide-react"/);
  assert.doesNotMatch(
    surfaceIcons,
    /<svg/,
    "Surface/module icons should come from lucide-react instead of local SVG copies",
  );
  assert.match(shellSidebar, /from "lucide-react"/);
});

test("tauri-ui-engineering: workspace surfaces use adaptive app primitives", async () => {
  const topbar = await read("apps/workspace/src/surfaces/site-admin/SiteAdminTopBar.tsx");
  const calendar = await read("apps/workspace/src/surfaces/calendar/CalendarSurface.tsx");
  const viewSwitcher = await read("apps/workspace/src/surfaces/calendar/ViewSwitcher.tsx");
  const sourceSidebar = await read("apps/workspace/src/surfaces/calendar/SourceSidebar.tsx");
  const todosNav = await read("apps/workspace/src/surfaces/todos/nav.tsx");
  const todosSurface = await read("apps/workspace/src/surfaces/todos/TodosSurface.tsx");
  const sidebar = await read("apps/workspace/src/shell/Sidebar.tsx");
  const app = await read("apps/workspace/src/App.tsx");
  const styles = await readWorkspaceCssBundle();

  assert.match(topbar, /WorkspaceCommandBar/);
  assert.match(topbar, /WorkspaceCommandGroup/);
  assert.match(topbar, /WorkspaceCommandButton/);
  assert.doesNotMatch(topbar, /leading=\{<span className="workspace-commandbar__meta">Site Admin<\/span>\}/);
  assert.match(calendar, /WorkspaceCommandBar/);
  assert.match(calendar, /WorkspaceCommandGroup/);
  assert.match(calendar, /WorkspaceCommandButton/);
  assert.match(calendar, /WorkspaceSplitView/);
  assert.match(calendar, /className="calendar-workspace-split"/);
  assert.doesNotMatch(calendar, /gridTemplateColumns: selectedEvent/);
  assert.match(viewSwitcher, /WorkspaceSegmentedControl/);
  assert.doesNotMatch(viewSwitcher, /shadow_\[|bg-white/);
  assert.match(sourceSidebar, /SOURCE_ORDER_STORAGE_KEY/);
  assert.match(sourceSidebar, /SOURCE_COLLAPSED_STORAGE_KEY/);
  assert.match(sourceSidebar, /calendar-source-group__toggle/);
  assert.match(sourceSidebar, /WorkspaceSidebarRow/);
  assert.match(sourceSidebar, /application\/x-calendar-source/);
  assert.match(sourceSidebar, /moveSourceTo\(sourceId, src\.id, edge\)/);
  assert.match(sourceSidebar, /draggable/);
  assert.match(sourceSidebar, /calendar-source-row__menu/);
  assert.doesNotMatch(sourceSidebar, /onSetCalendarDefault/);
  assert.doesNotMatch(sourceSidebar, /borderRight:/);
  assert.match(todosNav, /TODOS_FOCUS_NAV_GROUP_ID/);
  assert.match(todosNav, /TODOS_SCHEDULE_NAV_GROUP_ID/);
  assert.match(todosNav, /TODOS_REVIEW_NAV_GROUP_ID/);
  assert.match(todosNav, /createTodosNavGroups/);
  assert.doesNotMatch(todosNav, /hideHeader: true/);
  assert.match(todosSurface, /setNavGroupItems/);
  assert.match(todosSurface, /createTodosNavGroups\(navCounts\)/);
  const titlebar = await read("apps/workspace/src/shell/Titlebar.tsx");
  const settingsWindow = await read("apps/workspace/src/shell/SettingsWindow.tsx");
  assert.match(app, /SIDEBAR_COLLAPSED_STORAGE_KEY/);
  assert.match(titlebar, /titlebar-sidebar-toggle/);
  assert.match(titlebar, /titlebar-tabs/);
  assert.match(titlebar, /titlebar-tab-add/);
  assert.match(titlebar, /aria-expanded=\{!sidebarCollapsed\}/);
  assert.match(settingsWindow, /settings-window/);
  assert.match(sidebar, /sidebar-settings-button/);
  assert.match(app, /SURFACE_ORDER_STORAGE_KEY/);
  assert.match(app, /orderWorkspaceSurfaces/);
  assert.match(app, /onReorderSurface=\{handleReorderSurface\}/);
  assert.match(sidebar, /application\/x-workspace-surface/);
  assert.match(sidebar, /FIXED_APP_RAIL_SURFACE_ID = "workspace"/);
  assert.match(sidebar, /data-surface-reorderable/);
  assert.match(styles, /\.calendar-workspace-split/);
  assert.match(styles, /\.calendar-commandbar__supplement/);
  assert.match(styles, /\.calendar-publish-panel/);
  assert.match(styles, /\.calendar-event-composer--inspector/);
  assert.match(calendar, /CalendarPublishPanel/);
  assert.match(calendar, /CalendarUndoToast/);
  assert.doesNotMatch(styles, /\.calendar-commandbar__sync/);
  assert.match(styles, /\.calendar-source-group__header/);
  assert.match(styles, /\.calendar-source-group__drag/);
  assert.match(
    styles,
    /\.calendar-source-row\s*\{[\s\S]*--sidebar-depth/,
    "Calendar source rows should inherit the shared sidebar depth system",
  );
  assert.match(styles, /data-drop-edge="before"/);
  assert.match(styles, /\.sidebar-surface\[data-collapsed="true"\]/);
  assert.match(styles, /\.app-shell:has\(\.sidebar-surface\[data-collapsed="true"\]\)/);
  assert.match(styles, /\.sidebar-app-rail__footer/);
  assert.match(styles, /\.titlebar-sidebar-toggle/);
  assert.match(styles, /\.titlebar-tabs/);
  assert.match(styles, /\.settings-window/);
  assert.match(styles, /\.sidebar-app-rail__button\[data-surface-reorderable="true"\]/);
  assert.match(styles, /\.sidebar-app-rail__button\[data-drop-edge="before"\]::before/);
  assert.match(styles, /\.sidebar-surface\s*\{[\s\S]*position: fixed;/);
  assert.match(styles, /\.sidebar-context-pane,[\s\S]*\.sidebar-footer\s*\{[\s\S]*display: none;/);
});

test("tauri-ui-engineering: Notes is a local surface using the shared editor runtime", async () => {
  // Surface registration moved into per-module manifests; surfaces/registry.tsx
  // is now a thin re-export of `ALL_WORKSPACE_SURFACES` from modules/registry.
  const registry = await read("apps/workspace/src/modules/notes/index.tsx");
  const app = await read("apps/workspace/src/App.tsx");
  const surfaceNavContext = await read(
    "apps/workspace/src/shell/surface-nav-context.tsx",
  );
  const notesNav = await read("apps/workspace/src/surfaces/notes/nav.tsx");
  const notesSurface = await read("apps/workspace/src/surfaces/notes/NotesSurface.tsx");
  const notesTree = await read("apps/workspace/src/surfaces/notes/tree.tsx");
  const sidebarSource = await read("apps/workspace/src/shell/Sidebar.tsx");
  const utilities = await read("apps/workspace/src/styles/utilities.css");
  const editorRuntime = await read("apps/workspace/src/ui/editor-runtime.tsx");
  const documentEditor = await read(
    "apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx",
  );
  const blocksEditor = await read(
    "apps/workspace/src/surfaces/site-admin/blocks-editor.tsx",
  );
  // Notes-specific wrappers moved into the notes module manifest
  // (`modules/notes/api.ts`) when the surfaces directory was reorganised.
  // `lib/tauri.ts` now only carries shell-level commands.
  const tauriWrappers = await read("apps/workspace/src/modules/notes/api.ts");
  const tauriEntrypoint = [
    await read("apps/workspace/src-tauri/src/main.rs"),
    await read("apps/workspace/src-tauri/src/lib.rs"),
  ].join("\n");
  const notesRs = await read("apps/workspace/src-tauri/src/notes.rs");
  const localDb = await read("apps/workspace/src-tauri/src/local_db.rs");
  const styles = await readWorkspaceCssBundle();

  assert.match(registry, /id: "notes"/);
  assert.match(registry, /NotesSurface/);
  assert.match(registry, /NotesIcon/);
  assert.match(notesSurface, /WorkspaceEditorRuntimeProvider/);
  assert.match(notesSurface, /BlocksEditor/);
  assert.match(notesSurface, /notes-editor__title workspace-editor-title-input/);
  assert.match(
    notesSurface,
    /NOTE_TEMPLATE_ICON_BY_ID/,
    "Notes home templates should render through the shared lucide icon system",
  );
  assert.match(styles, /\.notes-home__template-icon/);
  // Both Notes and site-admin inherit appearance / padding / line-height
  // from `.workspace-editor-title-input` and only override the
  // `--workspace-editor-title-*` design tokens. This keeps a single
  // place to fix WebKit-specific rendering issues (descender clipping,
  // native textfield chrome) instead of two parallel rule sets.
  assert.match(styles, /\.workspace-editor-title-input \{/);
  assert.match(styles, /--workspace-editor-title-line-height/);
  assert.match(styles, /\.notes-editor__title \{[^}]*--workspace-editor-title-size/);
  assert.match(
    styles,
    /\.mdx-document-editor__title \{[^}]*--workspace-editor-title-size/,
  );
  assert.match(notesSurface, /setNavGroupItems\(\s*NOTES_PAGES_NAV_GROUP_ID/);
  assert.doesNotMatch(notesSurface, /setNavItemChildren\(NOTES_ROOT_NAV_ID/);
  assert.match(notesNav, /NOTES_ARCHIVE_NAV_ITEM/);
  assert.match(notesNav, /NOTES_HOME_NAV_ITEM/);
  assert.match(notesNav, /NOTES_PAGES_NAV_GROUP_ID/);
  assert.match(notesNav, /NOTES_SYSTEM_NAV_GROUP_ID/);
  assert.match(notesNav, /addItemId: NOTES_ADD_ROOT_NAV_ID/);
  assert.match(
    styles,
    /\.sidebar-tree__group-add/,
    "Notes Pages group should expose a first-level page creation affordance",
  );
  assert.match(
    sidebarSource,
    /function SidebarTreeIconSlot/,
    "Surface nav rows should share one icon-slot component instead of per-feature indentation",
  );
  assert.match(styles, /--sidebar-tree-disclosure-width/);
  assert.match(styles, /\.sidebar-tree \.sidebar-nav-item-icon\[data-empty="true"\]/);
  assert.doesNotMatch(
    utilities,
    /\.sidebar-tree__item\s*\{[\s\S]*padding-inline-start:/,
    "Responsive utilities should not override the shared sidebar tree indentation",
  );
  assert.match(surfaceNavContext, /setNavGroupItems/);
  assert.match(app, /navGroupItems/);
  assert.match(app, /navGroupItems\[group\.id\] \?\? group\.items/);
  assert.match(
    sidebarSource,
    /filter\(\(entry\) => entry\.orderable\)/,
    "Sidebar reorder controls should work for Notes, not only site-admin page ids",
  );
  assert.match(notesSurface, /SAVE_DEBOUNCE_MS = 600/);
  // Notes must not pull in the site-admin context — it has no
  // SiteAdminProvider ancestor. Match the actual call or import shape;
  // bare-word matches catch documentation comments that explain *why*
  // the hook is off-limits.
  assert.doesNotMatch(notesSurface, /\buseSiteAdmin\s*\(/);
  assert.doesNotMatch(notesSurface, /from\s+["'][^"']*\/site-admin\/state["']/);
  assert.match(notesTree, /buildNoteTree/);
  assert.match(notesTree, /noteTreeToNavItems/);
  assert.match(notesTree, /draggable: true/);
  assert.match(notesTree, /droppable: true/);
  assert.match(notesTree, /orderable: true/);
  assert.match(editorRuntime, /export function WorkspaceEditorRuntimeProvider/);
  assert.match(editorRuntime, /export function useWorkspaceEditorRuntime/);
  // The runtime hook is consumed inside the block-editing canvas (now
  // its own file). MdxDocumentEditor only provides the runtime via the
  // Provider, so the consumer assertion moved to blocks-editor.tsx.
  assert.match(blocksEditor, /useWorkspaceEditorRuntime/);
  assert.match(documentEditor, /assetsEnabled/);
  assert.match(documentEditor, /WorkspaceEditorRuntimeProvider/);
  assert.match(tauriWrappers, /export function notesList/);
  assert.match(tauriWrappers, /export function notesMove/);
  assert.match(tauriWrappers, /export function notesSearch/);
  assert.match(tauriEntrypoint, /mod notes;/);
  assert.match(tauriEntrypoint, /notes::notes_list/);
  assert.match(tauriEntrypoint, /notes::notes_archive/);
  assert.match(localDb, /CREATE TABLE IF NOT EXISTS notes/);
  assert.match(localDb, /idx_notes_parent_order/);
  assert.match(notesRs, /cannot move a note inside one of its descendants/);
  assert.match(notesRs, /WITH RECURSIVE tree/);
  assert.match(styles, /\.notes-surface/);
  assert.match(styles, /\.notes-editor__title/);
  assert.match(styles, /\.notes-save-state/);
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
  assert.match(blockRenderers, /detailed editing lives in the unified BlockInspector/);
  assert.match(blockRenderers, /LinkItemsEditor/);
  assert.match(blockRenderers, /mdx-document-table-block__cell/);
  assert.match(blockRenderers, /mdx-document-hero-block__title-input/);
  assert.match(blockRenderers, /Select this block to add links/);
  assert.match(blockRenderers, /Select this block to add cards/);
  assert.match(blockRenderers, /Select this block to configure columns/);
  assert.match(blockRenderers, /Select this block to add teaching links/);
  assert.match(blockRenderers, /Select this block to add profile links/);
  assert.doesNotMatch(blockRenderers, /aria-label="Bookmark URL"/);
  assert.doesNotMatch(blockRenderers, /aria-label="Column count"/);
  assert.doesNotMatch(blockRenderers, /mdx-document-page-link-block__picker/);
  assert.doesNotMatch(blockRenderers, /mdx-document-link-list-block__item-actions/);
  assert.doesNotMatch(blockRenderers, /uploadGenericFile/);
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
  const publishFlowModel = await read(
    "apps/workspace/src/surfaces/site-admin/publish-flow-model.ts",
  );
  const publishPreviewPanel = await read(
    "apps/workspace/src/surfaces/site-admin/PublishPreviewPanel.tsx",
  );
  const publishPreflightPanel = await read(
    "apps/workspace/src/surfaces/site-admin/PublishPreflightPanel.tsx",
  );
  const statusPanel = await read("apps/workspace/src/surfaces/site-admin/StatusPanel.tsx");
  const releasePanel = await read("apps/workspace/src/surfaces/site-admin/ReleasePanel.tsx");
  const releaseFlow = await read(
    "apps/workspace/src/surfaces/site-admin/release-flow-model.ts",
  );
  const pipeline = await read(
    "apps/workspace/src/surfaces/site-admin/PublishPipelineCard.tsx",
  );

  assert.match(releaseFlow, /export function deriveReleaseFlow/);
  assert.match(releaseFlow, /RELEASE_FROM_DISPATCH_ACTIONS_URL/);
  assert.match(releaseFlow, /DEPLOY_ON_CONTENT_ACTIONS_URL/);
  assert.match(publishButton, /deriveSiteHealth/);
  assert.match(publishButton, /contentDirty/);
  assert.match(publishButton, /outbox\.status\.pending/);
  assert.match(publishFlowModel, /export function parseDeployPreview/);
  assert.match(publishFlowModel, /export function parseStatusPayload/);
  assert.match(publishPreviewPanel, /Staging candidate is stale/);
  assert.match(publishPreflightPanel, /blockingDiagnostics/);
  assert.match(publishButton, /DEPLOY_VERSION_STALE/);
  assert.match(releaseFlow, /GitHub Actions “Deploy \(auto\)”/);
  assert.match(releaseFlow, /GitHub Actions “Release from dispatch”/);
  assert.match(releaseFlow, /npm run release:staging/);
  assert.match(publishButton, /Recheck/);
  assert.match(publishButton, /parseDeployResponseSummary/);
  assert.match(publishButton, /Staging release queued in GitHub Actions/);
  assert.doesNotMatch(
    publishButton,
    /Publish failed: \$\{response\.code\}: \$\{response\.error\}[\s\S]*DEPLOY_VERSION_STALE/,
    "DEPLOY_VERSION_STALE should be translated into a rebuild/recheck message, not shown as a raw failure",
  );
  assert.match(statusPanel, /releaseWorkflowRecovery/);
  assert.match(statusPanel, /PublishPipelineCard/);
  assert.doesNotMatch(statusPanel, /\/api\/site-admin\/deploy/);
  assert.doesNotMatch(statusPanel, /Confirm Deploy/);
  assert.match(statusPanel, /Content source/);
  assert.match(statusPanel, /Next action/);
  assert.match(releaseFlow, /D1 content database/);
  assert.match(statusPanel, /Release Health/);
  assert.match(statusPanel, /Site sync and release health/);
  assert.match(statusPanel, /Active deploy/);
  assert.match(statusPanel, /Latest upload/);
  assert.match(statusPanel, /Latest Uploaded Version/);
  assert.match(pipeline, /Saved source/);
  assert.match(pipeline, /Worker candidate/);
  assert.match(pipeline, /Staging deploy/);
  assert.match(pipeline, /Production promotion remains explicit/);
  assert.match(releaseFlow, /D1 source has no branch diff/);
  assert.match(releasePanel, /RELEASE_PROD_FROM_STAGING_COMMAND/);
  assert.match(releasePanel, /LEGACY_RELEASE_PROD_COMMAND/);
  assert.match(releasePanel, /parsePromotePreview/);
  assert.match(releasePanel, /\/api\/site-admin\/promote-to-production/);
  assert.doesNotMatch(releasePanel, /localStorage/);
  assert.match(releasePanel, /PromoteToProductionButton/);
  assert.match(releasePanel, /Advanced command fallback/);
  assert.match(releasePanel, /Production promotion starts from Staging/);
  assert.match(releasePanel, /Promotion Checklist/);
  assert.match(releasePanel, /Environment comparison/);
  assert.match(releasePanel, /Production differs/);
  assert.match(releasePanel, /Release preflight reads staging and production deployments live/);
});

test("tauri-ui-engineering: site admin has a unified topbar save action", async () => {
  const state = await read("apps/workspace/src/surfaces/site-admin/state.tsx");
  const topbar = await read("apps/workspace/src/surfaces/site-admin/SiteAdminTopBar.tsx");
  const documentEditor = await read(
    "apps/workspace/src/surfaces/site-admin/MdxDocumentEditor.tsx",
  );
  const configPanel = await read("apps/workspace/src/surfaces/site-admin/ConfigPanel.tsx");
  const navigationPanel = await read(
    "apps/workspace/src/surfaces/site-admin/NavigationPanel.tsx",
  );

  assert.match(state, /topbarSaveAction/);
  assert.match(state, /setTopbarSaveAction/);
  assert.match(topbar, /topbarSaveAction\?\.dirty/);
  assert.match(topbar, /site-admin-topbar__save-btn/);
  assert.match(topbar, /contentDirty=\{Boolean\(topbarSaveAction\?\.dirty\)\}/);
  assert.match(topbar, /outbox=\{outbox\}/);
  assert.match(topbar, /sync=\{sync\}/);
  assert.match(documentEditor, /setTopbarSaveAction/);
  assert.match(configPanel, /setTopbarSaveAction/);
  assert.match(navigationPanel, /setTopbarSaveAction/);
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
  // Quick action labels moved into module manifests under
  // `apps/workspace/src/modules/*/index.tsx`. The palette renders them
  // generically via `getCommandActions()`, so the literal label string
  // now lives next to the surface that owns it.
  const siteAdminModule = await read(
    "apps/workspace/src/modules/site-admin/index.tsx",
  );
  const linkAudit = await read(
    "apps/workspace/src/surfaces/site-admin/LinkAuditPanel.tsx",
  );

  assert.match(types, /\| "links"/);
  assert.match(nav, /id: "links"/);
  assert.match(surface, /LinkAuditPanel/);
  assert.match(siteAdminModule, /Open Link Audit/);
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
