import assert from "node:assert/strict";
import test from "node:test";
import { changedCollectionEntries, editorPublicationAction } from "../../app/site-admin/site-admin-editor-publication.ts";

const path = "components/news.mdx";
const href = "/news";
const news = (id, text = id) => `<NewsEntry entryId="${id}" date="2026-11-19">\n\n${text}\n\n</NewsEntry>\n`;
const change = (before, after) => ({ path, oldPath: "", title: "News", kind: "changed", before, after });

test("Publication controls distinguish a saved entry from current peers", () => {
  const update = change(news("a") + news("b"), news("new") + news("a") + news("b", "Edited"));
  const changes = changedCollectionEntries("news", update);
  assert.deepEqual([...changes], [["new", true], ["a", false], ["b", true]]);
  const inputs = { path, href, change: update, scopes: new Set(["news:b"]) };
  assert.deepEqual(editorPublicationAction({ ...inputs, entry: { scope: "news:a", changed: false } }), { kind: "live", href });
  assert.deepEqual(editorPublicationAction({ ...inputs, entry: { scope: "news:b", changed: true } }),
    { kind: "review", label: "Review entry", scope: "news:b" });
  assert.equal(editorPublicationAction({ ...inputs, entry: { scope: "news:unknown" } }), null);
  const collection = editorPublicationAction(inputs);
  assert.equal(collection.scope, "", "News can require an explicit selection rather than defaulting to all");
});

test("A coupled change uses a named group scope rather than a non-publishable entry scope", () => {
  const update = change(news("a") + news("b"), news("b") + news("a"));
  assert.deepEqual([...changedCollectionEntries("news", update)], [["b", true], ["a", true]]);
  const entry = { scope: "works:row", changed: true };
  const document = "document:components/works.mdx";
  const inputs = { path: "components/works.mdx", href: "/works", change: update, scopes: new Set([document]), entry };
  const action = editorPublicationAction(inputs);
  assert.equal(action.label, "Review collection");
  assert.equal(action.scope, document);
  assert.match(action.detail, /cannot be published separately/);
  const groupRequired = editorPublicationAction({ ...inputs, scopes: new Set() });
  assert.equal(groupRequired.label, "Review all changes");
  assert.equal(groupRequired.scope, "all");
});

test("Retries never widen the scope of an independently reviewable entry", () => {
  const update = change(news("a"), news("a", "After"));
  const input = { path, href, change: update, scopes: new Set(["news:a"]) };
  const entry = { scope: "news:a", changed: true };
  assert.equal(editorPublicationAction({ ...input, entry, retryScope: "all" }).scope, "news:a");
  assert.equal(editorPublicationAction({ ...input, entry, retryScope: "news:a" }).label, "Review and retry");
  assert.equal(editorPublicationAction({ ...input, retryScope: "all" }).label, "Review all changes again");
  assert.equal(editorPublicationAction({ ...input, retryScope: "news:removed" }).scope, "");
  assert.deepEqual(editorPublicationAction({ ...input, change: undefined, retryScope: "all" }), { kind: "live", href });
  assert.equal(editorPublicationAction({ ...input, href: "", change: undefined }), null);
});
