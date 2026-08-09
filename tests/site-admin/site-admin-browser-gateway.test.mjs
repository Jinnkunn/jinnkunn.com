import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("site-admin browser gateway route exists and is auth gated", () => {
  const source = fs.readFileSync("app/site-admin/page.tsx", "utf8");
  assert.match(source, /getSiteAdminSessionIdentity/);
  assert.match(source, /isAllowedAdminSessionIdentity/);
  assert.match(source, /getSiteAdminMobileSummary/);
  assert.ok(source.includes("/api/auth/signin"));
});

test("site-admin browser gateway renders the unified content workspace", () => {
  const pageSource = fs.readFileSync("app/site-admin/page.tsx", "utf8");
  const source = fs.readFileSync("app/site-admin/site-admin-web-console.tsx", "utf8");
  assert.ok(pageSource.includes("SiteAdminWebConsole"));
  assert.ok(source.includes("Publish"));
  assert.ok(source.includes("Content"));
  assert.ok(source.includes("Media"));
  assert.ok(source.includes("Settings"));
  assert.ok(source.includes("Now"));
  assert.ok(source.includes("New content"));
  assert.ok(source.includes("Publish live"));
  assert.ok(source.includes("Publish status unavailable"));
  assert.ok(source.includes('<StatusNotice tone="warning">{warning}</StatusNotice>'));
  assert.ok(source.includes("isUnauthorizedMessage"));
  assert.ok(!source.includes("The browser gateway is signed in"));
  assert.ok(!source.includes("Authenticated Site Admin gateway"));
});

test("site-admin browser console keeps form controls inside panels", () => {
  const css = fs.readFileSync("app/site-admin/site-admin-dashboard.module.css", "utf8");
  const globals = fs.readFileSync("app/globals.css", "utf8");
  const source = fs.readFileSync("app/site-admin/site-admin-web-console.tsx", "utf8");
  assert.match(globals, /scrollbar-gutter: stable;/);
  assert.match(css, /\.shell \{\n  width: min\(1740px, calc\(100% - 40px\)\);/);
  assert.match(css, /\.shell,\n\.shell \* \{\n  box-sizing: border-box;/);
  assert.match(source, /data-area=\{area\}/);
  assert.match(
    css,
    /\.workspaceGrid[\s\S]*grid-template-columns: minmax\(260px, 320px\) minmax\(0, 1fr\);/,
  );
  assert.match(
    css,
    /\.contentWorkspace[\s\S]*grid-template-columns: minmax\(250px, 310px\) minmax\(680px, 1fr\);/,
  );
  assert.match(css, /\.inspectorPanel[\s\S]*position: fixed;[\s\S]*overflow: auto;/);
  assert.match(css, /\.drawerScrim[\s\S]*position: fixed;/);
  assert.match(css, /\.releaseSteps[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /container-type: inline-size;/);
  assert.match(css, /@container \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /\.contentWorkspace \{\n    grid-template-columns: minmax\(230px, 290px\) minmax\(0, 1fr\);/);
  assert.match(css, /\.inspectorPanel\[data-open="true"\]/);
  assert.match(css, /\.sidePanel \{[\s\S]*overflow-y: auto;/);
  assert.match(css, /\.contentIndexRow \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.editorTitleGrid[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.editorDetails[\s\S]*background: var\(--ds-surface-soft\);/);
  assert.match(css, /\.editorBodyShell[\s\S]*flex: 1;/);
});

test("site-admin browser console uses the visual-first MDX editor", () => {
  const source = fs.readFileSync("app/site-admin/site-admin-web-console.tsx", "utf8");
  const editor = fs.readFileSync("app/site-admin/site-admin-markdown-editor.tsx", "utf8");
  const visual = fs.readFileSync("app/site-admin/site-admin-visual-editor.tsx", "utf8");
  const sourceEditor = fs.readFileSync("app/site-admin/site-admin-source-editor.tsx", "utf8");
  const compatibility = fs.readFileSync(
    "lib/site-admin/mdx-visual-compatibility.ts",
    "utf8",
  );
  assert.ok(source.includes("SiteAdminMarkdownEditor"));
  assert.ok(source.includes("sourceForNewContent"));
  assert.ok(source.includes("slugFromTitle"));
  assert.ok(source.includes("resolvedCreateSlug"));
  assert.ok(source.includes("setCreateTitle"));
  assert.ok(source.includes("setCreateDescription"));
  assert.ok(source.includes("sourceForEditedContent"));
  assert.ok(source.includes("frontmatterKeys"));
  assert.ok(source.includes("contentSavedAt"));
  assert.ok(source.includes("Unsaved edits"));
  assert.ok(source.includes("Ready to publish"));
  assert.ok(source.includes("Save first"));
  assert.ok(source.includes("editorTitleGrid"));
  assert.ok(source.includes("editorDetails"));
  assert.ok(source.includes("editorBodyShell"));
  assert.ok(source.includes("inspectorPanel"));
  assert.ok(source.includes("createDrawer"));
  assert.ok(source.includes("renderContentLibrary"));
  assert.ok(source.includes("renderDocumentIndex"));
  assert.ok(source.includes("Search posts and pages"));
  assert.ok(source.includes("contentIndexList"));
  assert.ok(source.includes("releaseSteps"));
  assert.ok(source.includes("/api/site-admin/release-jobs/smart"));
  assert.ok(source.includes("contentPublishActionForBrowser"));
  assert.ok(source.includes('"publish-content-production"'));
  assert.ok(source.includes('"publish-content-staging"'));
  assert.ok(source.includes("queueSavedContentPublish"));
  assert.ok(source.includes("Content was saved, but publishing could not be queued"));
  assert.ok(source.includes("moveSelectedContent"));
  assert.ok(source.includes("localDraftKey"));
  assert.ok(source.includes("releaseWatchUntil"));
  assert.ok(source.includes("saveSelectedContentRef"));
  assert.ok(source.includes("quiet: true"));
  assert.ok(source.includes("newerLocalEdits"));
  assert.ok(source.includes("await refreshSummaryOnly();"));
  assert.ok(source.includes("beginCreate"));
  assert.ok(source.includes('type ContentMode = "browse" | "edit" | "create"'));
  assert.ok(source.includes('setContentMode("browse")'));
  assert.ok(source.includes('setContentMode("edit")'));
  assert.ok(source.includes('setContentMode("create")'));
  assert.ok(!source.includes('<h2 className={styles.panelTitle}>Select content</h2>'));
  assert.ok(!source.includes('previewLayout="split"'));
  assert.ok(source.includes("Back"));
  assert.ok(editor.includes("Source"));
  assert.ok(editor.includes("Preview"));
  assert.ok(editor.includes("Write"));
  assert.ok(editor.includes('data-layout={previewLayout}'));
  assert.ok(editor.includes("markdownModeButton"));
  assert.ok(editor.includes("SiteAdminVisualEditor"));
  assert.ok(editor.includes("onEditComponent"));
  assert.ok(editor.includes("SiteAdminSourceEditor"));
  assert.ok(editor.includes("analyzeVisualMdxCompatibility"));
  assert.ok(editor.includes("Write mode is unavailable"));
  assert.ok(editor.includes('disabled={!visualAvailable}'));
  assert.ok(visual.includes("new Crepe"));
  assert.ok(visual.includes("MDX component"));
  assert.ok(visual.includes("uploadSiteAdminAsset"));
  assert.ok(visual.includes("markdownUpdated"));
  assert.ok(visual.includes('data-component-action'));
  assert.ok(visual.includes('data-mdx-component'));
  assert.ok(sourceEditor.includes("new EditorView"));
  assert.ok(sourceEditor.includes("handlePaste"));
  assert.ok(sourceEditor.includes("uploadSiteAdminAsset"));
  assert.ok(compatibility.includes('case "mdxJsxFlowElement"'));
  assert.ok(compatibility.includes("isStaticSelfClosingComponent"));
});

test("site-admin content management includes recovery, media, settings, and version history", () => {
  const source = fs.readFileSync("app/site-admin/site-admin-web-console.tsx", "utf8");
  const css = fs.readFileSync("app/site-admin/site-admin-dashboard.module.css", "utf8");
  const versions = fs.readFileSync("app/api/site-admin/versions/route.ts", "utf8");

  assert.ok(source.includes("SiteAdminMediaLibrary"));
  assert.ok(source.includes("SiteAdminSettingsPanel"));
  assert.ok(source.includes("SiteAdminVersionHistory"));
  assert.ok(source.includes("SiteAdminConflictDialog"));
  assert.ok(source.includes("beforeunload"));
  assert.ok(source.includes("window.localStorage"));
  assert.ok(source.includes("LOCAL_DRAFT_TTL_MS"));
  assert.ok(source.includes("duplicatePublicationItem"));
  assert.ok(source.includes("duplicateTeachingItem"));
  assert.ok(source.includes("duplicateWorksItem"));
  assert.ok(css.includes(".assetGrid"));
  assert.ok(css.includes(".versionCompareGrid"));
  assert.ok(css.includes(".settingsNavRow"));
  assert.match(versions, /content\\\/components\\\//);
  assert.ok(versions.includes("commitSha"));
});

test("site-admin browser console treats data pages as managed collections", () => {
  const source = fs.readFileSync("app/site-admin/site-admin-web-console.tsx", "utf8");
  const collectionEditor = fs.readFileSync(
    "app/site-admin/site-admin-structured-collection-editor.tsx",
    "utf8",
  );
  const collectionModel = fs.readFileSync(
    "app/site-admin/site-admin-structured-collection-model.ts",
    "utf8",
  );
  const collectionSchema = fs.readFileSync(
    "app/site-admin/site-admin-structured-collection-schema.ts",
    "utf8",
  );
  const implementation = [source, collectionEditor, collectionModel, collectionSchema].join("\n");
  const css = fs.readFileSync("app/site-admin/site-admin-dashboard.module.css", "utf8");

  assert.ok(source.includes("findManagedComponentInBody"));
  assert.ok(source.includes("Managed collection"));
  assert.ok(source.includes("Open structured entries"));
  assert.ok(source.includes("componentReturnTarget"));
  assert.ok(source.includes("returnToComponentOrigin"));
  assert.ok(source.includes("editComponentByEmbedTag"));
  assert.ok(implementation.includes("News entries"));
  assert.ok(implementation.includes("parseNewsComponentDraft"));
  assert.ok(implementation.includes("serializeNewsComponentDraft"));
  assert.ok(implementation.includes("Teaching rows"));
  assert.ok(implementation.includes("Work rows"));
  assert.ok(implementation.includes("Publication rows"));
  assert.ok(implementation.includes("parseTeachingComponentDraft"));
  assert.ok(implementation.includes("serializeWorksComponentDraft"));
  assert.ok(implementation.includes("serializePublicationsComponentDraft"));
  assert.ok(collectionEditor.includes("Advanced component source"));
  assert.ok(source.includes("componentSearch"));
  assert.ok(collectionModel.includes("normalizeComponentEntryId"));
  assert.ok(collectionModel.includes("entryId"));
  assert.ok(source.includes("reorderSelectedComponentItems"));
  assert.ok(collectionEditor.includes("Review {issueCount}"));
  assert.ok(collectionEditor.includes("Expand all"));
  assert.ok(collectionEditor.includes("Group entries"));
  assert.ok(collectionEditor.includes("StructuredCollectionEntry"));
  assert.ok(collectionEditor.includes("StructuredCollectionEntryForm"));
  assert.ok(source.includes("<StructuredCollectionEditor"));
  assert.ok(source.includes("fields={NEWS_ENTRY_FIELDS}"));
  assert.ok(source.includes("fields={TEACHING_ENTRY_FIELDS}"));
  assert.ok(source.includes("fields={WORKS_ENTRY_FIELDS}"));
  assert.ok(source.includes("fields={PUBLICATION_ENTRY_FIELDS}"));
  assert.ok(collectionSchema.includes("writePublicationAuthors"));
  assert.ok(collectionSchema.includes("writePrimaryPublicationVenue"));
  assert.ok(collectionEditor.includes("Option + Down"));
  assert.ok(collectionEditor.includes("⌘↵ Done"));
  assert.ok(!source.includes("function renderComponentEditorHeader"));
  assert.ok(!source.includes("function renderComponentItemActions"));
  assert.ok(collectionSchema.includes("Highlighted author"));
  assert.ok(collectionSchema.includes("Venue"));
  assert.ok(source.includes("Managed ·"));
  assert.ok(css.includes(".managedPagePanel"));
  assert.ok(css.includes(".newsEntryCard"));
  assert.ok(css.includes(".newsDividerRow"));
  assert.ok(css.includes(".componentEntryGrid"));
  assert.ok(css.includes(".componentContextBar"));
  assert.ok(css.includes(".componentCollectionHeader"));
  assert.ok(css.includes(".entryReadiness"));
  assert.ok(css.includes(".collectionGroupHeading"));
  assert.ok(css.includes(".componentDragHandle"));
  assert.ok(css.includes(".fieldError"));
});

test("site-admin content detail APIs expose structured editor fields", () => {
  const postRoute = fs.readFileSync("app/api/site-admin/posts/[slug]/route.ts", "utf8");
  const pageRoute = fs.readFileSync("app/api/site-admin/pages/[...slug]/route.ts", "utf8");
  for (const source of [postRoute, pageRoute]) {
    assert.ok(source.includes("frontmatterKeys"));
    assert.ok(source.includes("body: parsed.body"));
  }
});

test("legacy site-admin login route redirects to the gateway", () => {
  const source = fs.readFileSync("app/site-admin/login/route.ts", "utf8");
  assert.ok(source.includes('new URL("/site-admin"'));
});
