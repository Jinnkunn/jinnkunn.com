import test from "node:test";
import assert from "node:assert/strict";
import { contentInventory, documentProblems } from "../../lib/shared/content-inventory.ts";
import { contentMatchesTask, readContentPins } from "../../app/site-admin/site-admin-content-tasks.ts";
import { buildPageTree, filterPageTree } from "../../app/site-admin/site-admin-page-tree-model.ts";

test("task filters use save time, not publication date, and do not guess unknown status", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const item = { issueCount: 0, modifiedAt: "2026-10-23T12:00:00Z" };
  assert.equal(contentMatchesTask(item, "recent", now), true);
  assert.equal(contentMatchesTask({ ...item, modifiedAt: null }, "recent", now), false);
  assert.equal(contentMatchesTask({ ...item, modifiedAt: "2026-11-23" }, "recent", now), false);
  assert.equal(contentMatchesTask(item, "pending", now), false);
  assert.equal(contentMatchesTask({ ...item, pending: true }, "pending", now), true);
  assert.equal(contentMatchesTask({ ...item, draft: true }, "hidden", now), true);
  assert.equal(contentMatchesTask({ ...item, issueCount: 1 }, "issues", now), true);
  assert.equal(contentMatchesTask({ ...item, pinned: true }, "pinned", now), true);
});
test("pins are bounded, deduplicated and reject unrelated storage shapes", () => {
  assert.deepEqual(readContentPins(JSON.stringify({ version: 1, items: ["pages:docs/start", "posts:hello", "pages:docs/start", "javascript:alert", "pages:../secret", 42] })), ["pages:docs/start", "posts:hello"]);
  assert.deepEqual(readContentPins("broken"), []);
  assert.deepEqual(readContentPins(JSON.stringify({ version: 9, items: ["posts:hello"] })), []);
});
test("task filtering retains parent titles and hierarchy without counting context as a match", () => {
  const tree = buildPageTree([{ id: "docs", title: "Documentation", problem: false }, { id: "docs/child", title: "Child", problem: true }]);
  const result = filterPageTree(tree, (item) => item.problem);
  assert.equal(result[0].title, "Documentation");
  assert.equal(result[0].item, null);
  assert.equal(result[0].children[0].item.title, "Child");
});
test("inventory retains invalid documents and reports fields without exposing source", () => {
  const inventory = contentInventory({
    "pages/empty.mdx": "---\ntitle: Empty\ndraft: true\n---\n",
    "posts/broken.mdx": "---\ntitle: [broken\n---\nText",
    "home.json": "{}",
  }, { "pages/empty.mdx": Date.parse("2026-10-24T12:00:00Z") });
  assert.equal(inventory.length, 2);
  assert.equal(inventory[0].hidden, true);
  assert.equal(inventory[0].issues[0].field, "body");
  assert.equal(inventory[0].modifiedAt, "2026-10-24T12:00:00.000Z");
  assert.equal(inventory[1].issues[0].field, "source");
  assert.equal(inventory[1].modifiedAt, null);
  assert.equal("source" in inventory[0], false);
});
test("document validation identifies date and unsafe image fields", () => {
  const issues = documentProblems('---\ntitle: Test\ndate: invalid\ncover: "javascript:alert(1)"\n---\nBody', "posts");
  assert.deepEqual(issues.map((issue) => issue.field), ["date", "cover"]);
  assert.deepEqual(documentProblems('---\ntitle: Managed\n---\n<NewsBlock />', "pages"), []);
});
test("collection inventory applies the same period and term rules as the editor", () => {
  const items = contentInventory({
    "components/works.mdx": '<WorksEntry role="Intern" period="Feb 2026 - Jan 2026">Text</WorksEntry>',
    "components/teaching.mdx": '<TeachingEntry term="2026/27" courseName="Course" />',
    "components/news.mdx": '<NewsEntry date="invalid">Text</NewsEntry>',
    "components/publications.mdx": "<PublicationsEntry data='invalid' />",
  });
  assert.equal(items[0].issues[0].field, "period");
  assert.equal(items[1].issues[0].field, "term");
  assert.equal(items[2].issues[0].field, "date");
  assert.equal(items[3].issues[0].field, "source");
  assert.equal(contentInventory({ "components/publications.mdx": "<PublicationsEntry data='{\"title\":1}' />" })[0].issues[0].field, "source");
});
