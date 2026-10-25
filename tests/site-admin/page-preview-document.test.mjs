import test from "node:test";
import assert from "node:assert/strict";
import { resolvePagePreviewDocument } from "../../lib/site-admin/page-preview-document.ts";
import { withPreviewSources, previewComponentSource } from "../../lib/posts/preview-context.ts";
import { staticMdxExpression } from "../../lib/site-admin/mdx-static-expressions.ts";

test("preview keeps unsaved metadata and uses published parents and adjacent posts", () => {
  const source = '---\ntitle: Unsaved title\ndate: 2026-10-25\n---\n## Draft body';
  const sources = { "posts/older.mdx": '---\ntitle: Older\ndate: 2025-01-01\n---\nBody', "posts/hidden.mdx": '---\ntitle: Hidden\ndate: 2026-01-01\ndraft: true\n---\nBody', "pages/docs.mdx": '---\ntitle: Published parent\n---\nIndex' };
  const post = resolvePagePreviewDocument({ title: "Stale title", source: "Ignored body", document: { kind: "posts", slug: "current", source } }, sources);
  assert.equal(post.entry.title, "Unsaved title"); assert.equal(post.entry.dateIso, "2026-10-25"); assert.equal(post.source.trim(), "## Draft body");
  assert.ok([post.adjacent.prev, post.adjacent.next].filter(Boolean).some((item) => item.title === "Older"));
  assert.equal([post.adjacent.prev, post.adjacent.next].filter(Boolean).some((item) => item.title === "Hidden"), false);
  const page = resolvePagePreviewDocument({ title: "Page", source: "", document: { kind: "pages", slug: "docs/start", source: '---\ntitle: Child\nupdated: 2026-10-24\n---\nBody' } }, sources);
  assert.equal(page.entry.updatedIso, "2026-10-24"); assert.equal(page.trail[0].label, "Published parent"); assert.equal(page.trail[1].label, "Child");
});
test("component previews retain public introduction and override only the selected collection", () => {
  const sources = { "pages/works.mdx": '---\ntitle: Works\n---\nTeaching introduction.\n\n<WorksBlock />', "components/works.mdx": "Published role", "components/news.mdx": "Published news" };
  const model = resolvePagePreviewDocument({ component: "works", routePath: "/works", title: "Works", source: "Unsaved role" }, sources);
  assert.ok(model.source.includes("Teaching introduction.")); assert.ok(model.source.includes("<WorksBlock />"));
  assert.equal(model.sources["components/works.mdx"], "Unsaved role"); assert.equal(model.sources["components/news.mdx"], "Published news");
  assert.equal(sources["components/works.mdx"], "Published role");
});
test("concurrent previews never leak component sources into one another", async () => {
  const render = (value) => withPreviewSources({ "components/news.mdx": value }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5)); return previewComponentSource("news");
  });
  assert.deepEqual(await Promise.all([render("A"), render("B")]), ["A", "B"]);
  assert.equal(previewComponentSource("news"), undefined);
  assert.equal(withPreviewSources({}, () => previewComponentSource("news")), "");
});
test("MDX static expressions accept data only and reject executable/property pollution syntax", () => {
  assert.equal(staticMdxExpression({ type: "Literal", value: "text" }), "text");
  assert.deepEqual(staticMdxExpression({ type: "ArrayExpression", elements: [{ type: "Literal", value: 7 }] }), [7]);
  assert.deepEqual(staticMdxExpression({ type: "ObjectExpression", properties: [{ type: "Property", kind: "init", key: { type: "Identifier", name: "color" }, value: { type: "Literal", value: "gray" } }] }), { color: "gray" });
  for (const type of ["CallExpression", "MemberExpression", "FunctionExpression", "ArrowFunctionExpression", "AssignmentExpression", "NewExpression"]) assert.throws(() => staticMdxExpression({ type }), /not executable/);
  assert.throws(() => staticMdxExpression({ type: "ObjectExpression", properties: [{ type: "Property", kind: "init", key: { type: "Identifier", name: "__proto__" }, value: { type: "Literal", value: "bad" } }] }), /Unsupported/);
});
