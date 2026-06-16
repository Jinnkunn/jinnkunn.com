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
  assert.ok(!source.includes('{summaryError ? <StatusNotice tone="warning">'));
  assert.ok(!source.includes("The browser gateway is signed in"));
  assert.ok(!source.includes("Authenticated Site Admin gateway"));
});

test("site-admin browser console keeps form controls inside panels", () => {
  const css = fs.readFileSync("app/site-admin/site-admin-dashboard.module.css", "utf8");
  assert.match(css, /\.shell,\n\.shell \* \{\n  box-sizing: border-box;/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /\.workspaceGrid[\s\S]*grid-template-columns: 1fr;/);
});

test("site-admin browser console uses the lightweight MDX editor", () => {
  const source = fs.readFileSync("app/site-admin/site-admin-web-console.tsx", "utf8");
  const editor = fs.readFileSync("app/site-admin/site-admin-markdown-editor.tsx", "utf8");
  assert.ok(source.includes("SiteAdminMarkdownEditor"));
  assert.ok(source.includes("sourceForNewContent"));
  assert.ok(source.includes("setCreateTitle"));
  assert.ok(source.includes("setCreateDescription"));
  assert.ok(source.includes("sourceForEditedContent"));
  assert.ok(source.includes("frontmatterKeys"));
  assert.ok(source.includes("editorMetaGrid"));
  assert.ok(source.includes("/api/site-admin/release-jobs/smart"));
  assert.ok(editor.includes("Source"));
  assert.ok(editor.includes("Preview"));
  assert.ok(editor.includes("markdownActions"));
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
