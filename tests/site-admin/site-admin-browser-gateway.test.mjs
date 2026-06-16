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

test("site-admin browser gateway renders a dashboard instead of a placeholder", () => {
  const pageSource = fs.readFileSync("app/site-admin/page.tsx", "utf8");
  const source = fs.readFileSync("app/site-admin/site-admin-web-console.tsx", "utf8");
  assert.ok(pageSource.includes("SiteAdminWebConsole"));
  assert.ok(source.includes("Dashboard"));
  assert.ok(source.includes("Release"));
  assert.ok(source.includes("Content"));
  assert.ok(source.includes("Calendar"));
  assert.ok(source.includes("Now"));
  assert.ok(source.includes("New content"));
  assert.ok(source.includes("Save Home"));
  assert.ok(source.includes("Publish draft"));
  assert.ok(source.includes("Release status unavailable"));
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
  assert.match(css, /\.shell \{\n  width: min\(1480px, calc\(100% - 40px\)\);/);
  assert.match(css, /\.shell,\n\.shell \* \{\n  box-sizing: border-box;/);
  assert.match(source, /data-area=\{area\}/);
  assert.match(
    css,
    /\.workspaceGrid[\s\S]*grid-template-columns: minmax\(260px, 320px\) minmax\(0, 1fr\);/,
  );
  assert.match(
    css,
    /\.contentWorkspace[\s\S]*grid-template-columns: minmax\(260px, 320px\) minmax\(720px, 1fr\);/,
  );
  assert.match(css, /container-type: inline-size;/);
  assert.match(css, /@container \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /\.contentWorkspace,[\s\S]*\.nowGrid \{\n    grid-template-columns: 1fr;/);
  assert.match(css, /\.editorPrimaryGrid[\s\S]*grid-template-columns: minmax\(0, 1\.35fr\)/);
  assert.match(css, /\.editorDetails[\s\S]*background: var\(--ds-surface-soft\);/);
  assert.match(css, /\.editorBodyShell[\s\S]*flex: 1;/);
});

test("site-admin browser console uses the lightweight MDX editor", () => {
  const source = fs.readFileSync("app/site-admin/site-admin-web-console.tsx", "utf8");
  const editor = fs.readFileSync("app/site-admin/site-admin-markdown-editor.tsx", "utf8");
  assert.ok(source.includes("SiteAdminMarkdownEditor"));
  assert.ok(source.includes("sourceForNewContent"));
  assert.ok(source.includes("slugFromTitle"));
  assert.ok(source.includes("resolvedCreateSlug"));
  assert.ok(source.includes("setCreateTitle"));
  assert.ok(source.includes("setCreateDescription"));
  assert.ok(source.includes("sourceForEditedContent"));
  assert.ok(source.includes("frontmatterKeys"));
  assert.ok(source.includes("contentSavedAt"));
  assert.ok(source.includes("Saved to Draft"));
  assert.ok(source.includes("Ready to publish"));
  assert.ok(source.includes("Save first"));
  assert.ok(source.includes("editorPrimaryGrid"));
  assert.ok(source.includes("editorDetails"));
  assert.ok(source.includes("editorBodyShell"));
  assert.ok(source.includes("editorMetaGrid"));
  assert.ok(source.includes("/api/site-admin/release-jobs/smart"));
  assert.ok(source.includes("moveSelectedContent"));
  assert.ok(source.includes("localDraftKey"));
  assert.ok(source.includes("releaseWatchUntil"));
  assert.ok(source.includes("await refreshSummaryOnly();"));
  assert.ok(source.includes("beginCreate"));
  assert.ok(source.includes('type ContentMode = "browse" | "edit" | "create"'));
  assert.ok(source.includes('setContentMode("browse")'));
  assert.ok(source.includes('setContentMode("edit")'));
  assert.ok(source.includes('setContentMode("create")'));
  assert.ok(source.includes("Select content"));
  assert.ok(source.includes('previewLayout="split"'));
  assert.ok(editor.includes("Source"));
  assert.ok(editor.includes("Preview"));
  assert.ok(editor.includes("Refresh preview"));
  assert.ok(editor.includes('data-layout={previewLayout}'));
  assert.ok(editor.includes("markdownActionGroups"));
  assert.ok(editor.includes("Inline formatting"));
  assert.ok(editor.includes("Block formatting"));
  assert.ok(editor.includes("Insert blocks"));
  assert.ok(editor.includes("markdownToolbarCluster"));
  assert.ok(editor.includes("markdownToolButton"));
  assert.ok(editor.includes("markdownModeButton"));
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
