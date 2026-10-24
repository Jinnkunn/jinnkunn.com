import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { publicationSnapshot, publicationSearchSnapshot, readPublicationSearch } from "../../lib/shared/publication-snapshot.mjs";
import { buildContentIndexes } from "../../scripts/build/prebuild.mjs";

test("published search moves with the publication and never falls back to a newer draft", () => {
  const baseline = publicationSnapshot({ "home.json": "published" });
  const draft = publicationSnapshot({ "home.json": "unpublished edit" });
  const oldIndex = [{ id: "home", routePath: "/", title: "Home", text: "published words", kind: "page" }];
  const search = publicationSearchSnapshot(baseline, oldIndex);
  const next = readPublicationSearch({ ...baseline, search }, { baseline: draft, index: [{ ...oldIndex[0], text: "private draft words" }], manifest: [] });
  assert.equal(next.snapshotSha, baseline.sha);
  assert.equal(next.index[0].text, "published words");
  assert.equal(readPublicationSearch(null, { baseline, index: oldIndex, manifest: [] }).snapshotSha, baseline.sha);
});
test("mismatched, missing, and malformed overlay indexes fail closed instead of serving stale results", () => {
  const baseline = publicationSnapshot({ "home.json": "published" });
  const other = publicationSnapshot({ "home.json": "different" });
  for (const search of [null, {}, publicationSearchSnapshot(other, [])]) {
    assert.throws(() => readPublicationSearch({ ...baseline, search }, { baseline, index: [], manifest: [] }), /Republish content/);
  }
});
test("search manifest cannot resurrect removed, hidden, or protected pages", () => {
  const baseline = publicationSnapshot({});
  const search = publicationSearchSnapshot(baseline, [{ id: "home", routePath: "/", title: "Home", kind: "page" }],
    ["/", "/deleted", "/hidden", "/protected", "/blog"].map((routePath) => ({ id: routePath, routePath, title: routePath })));
  assert.deepEqual(search.manifest.map((item) => item.routePath), ["/", "/blog"]);
});
test("home edits enter the next built publication search index", () => {
  const root = fs.mkdtempSync("/tmp/publication-search-");
  try {
    fs.mkdirSync(`${root}/content`, { recursive: true });
    fs.writeFileSync(`${root}/content/home.json`, JSON.stringify({ title: "Original title", bodyMdx: "Old biography" }));
    const first = buildContentIndexes(root).searchIndex;
    fs.writeFileSync(`${root}/content/home.json`, JSON.stringify({ title: "Updated title", bodyMdx: "Newly published searchable marker" }));
    const next = buildContentIndexes(root).searchIndex;
    assert.equal(first[0].text.includes("searchable marker"), false);
    assert.equal(next[0].title, "Updated title");
    assert.ok(next[0].text.includes("searchable marker"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("publisher stores and verifies the search version; API reads only the publication snapshot", () => {
  const api = fs.readFileSync("app/api/search/route.ts", "utf8");
  const publisher = fs.readFileSync("scripts/content/publish-content.mjs", "utf8");
  assert.match(api, /loadPublishedSearch\(\)/);
  assert.doesNotMatch(api, /getSearchIndex\(|getRoutesManifest\(/);
  assert.match(api, /x-publication-snapshot/);
  assert.match(publisher, /search: publicationSearchSnapshot/);
  assert.match(publisher, /Published search version mismatch/);
  assert.match(publisher, /currentStatus.searchVersion === 1/);
});
