import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { publicationSnapshot, publicationReview, assertPublicationSnapshot } from "../../lib/shared/publication-snapshot.mjs";
import { parseWorkspaceLocation, workspaceUrl } from "../../app/site-admin/site-admin-workspace-location.ts";
import { publicationLinks } from "../../lib/shared/publication-links.ts";

test("publication snapshot is deterministic and excludes generated, assets, and local data", () => {
  const first = publicationSnapshot({ "now.json": "A", "pages/a.mdx": "B", "local/private.json": "secret", "generated/a.json": "derived", "assets/a.png": "binary" });
  const second = publicationSnapshot({ "pages/a.mdx": "B", "now.json": "A" });
  assert.equal(first.sha, second.sha);
  assert.deepEqual(Object.keys(first.sources), ["now.json", "pages/a.mdx"]);
});
test("publication review includes cross-session edits, additions, deletions, and exact moves", () => {
  const before = publicationSnapshot({ "pages/old.mdx": "same", "posts/edit.mdx": "before", "pages/delete.mdx": "gone" });
  const after = publicationSnapshot({ "pages/new.mdx": "same", "posts/edit.mdx": "after", "home.json": "home" });
  const review = publicationReview(after, before);
  assert.deepEqual(review.changes.map((change) => change.kind).sort(), ["added", "changed", "deleted", "moved"]);
  assert.equal(review.changes.find((change) => change.kind === "changed").before, "before");
  assert.equal(review.changes.find((change) => change.kind === "moved").oldPath, "pages/old.mdx");
  assert.equal(publicationReview(after, after).changes.length, 0);
});
test("a queued publication cannot publish content added after confirmation", () => {
  const review = publicationSnapshot({ "home.json": "reviewed" });
  assertPublicationSnapshot(review, review.sha);
  assert.throws(() => assertPublicationSnapshot(publicationSnapshot({ "home.json": "newer" }), review.sha), /PUBLICATION_SNAPSHOT_CHANGED/);
});
test("ambiguous duplicate documents are not mislabeled as moves", () => {
  const review = publicationReview(publicationSnapshot({ "pages/new.mdx": "same" }), publicationSnapshot({ "pages/a.mdx": "same", "pages/b.mdx": "same" }));
  assert.deepEqual(review.changes.map((change) => change.kind).sort(), ["added", "deleted", "deleted"]);
});
test("publication baseline cannot be served by the static shell worker", () => {
  const worker = fs.readFileSync(new URL("../../cloudflare/worker-entry.mjs", import.meta.url), "utf8");
  assert.match(worker, /pathname\.startsWith\("\/__admin\/"\).*status: 404/);
  const publisher = fs.readFileSync(new URL("../../scripts/content/publish-content.mjs", import.meta.url), "utf8");
  assert.match(publisher, /assertPublicationSnapshot\(publicationBaseline, process\.env\.CONTENT_PUBLICATION_EXPECT_SNAPSHOT\)/);
  assert.match(publisher, /expectedRows: shellRows/);
});
test("workspace links restore nested documents and reject unknown sections", () => {
  const location = { area: "content", view: "pages", kind: "pages", id: "teaching/2026-27" };
  assert.deepEqual(parseWorkspaceLocation(workspaceUrl(location)), location);
  assert.deepEqual(parseWorkspaceLocation("/site-admin?area=invalid&view=invalid&kind=invalid&id=a"), { area: "content", view: "posts" });
});
test("publication resources are deduplicated, labeled accurately, and never invented", () => {
  assert.deepEqual(publicationLinks({}), []);
  const links = publicationLinks({ url: "https://www.arxiv.org/abs/1234", arxivUrl: "https://arxiv.org/abs/1234", doiUrl: "https://doi.org/10.1234/test", externalUrls: ["https://github.com/org/repo", "javascript:alert(1)", "/publications", "https://user:password@example.com/"] });
  assert.deepEqual(links.map((link) => link.label), ["DOI", "arXiv", "Code"]);
  assert.equal(publicationLinks({ doiUrl: "https://aclanthology.org/paper/" })[0].label, "Paper");
});
