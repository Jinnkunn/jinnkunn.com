import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePublicationsEntries, parseWorksEntries } from "../../lib/components/parse.ts";
import { parsePublicationsComponentDraft, serializePublicationsComponentDraft, parseWorksComponentDraft, serializeWorksComponentDraft } from "../../app/site-admin/site-admin-structured-collection-model.ts";
import { buildSearchResponse } from "../../lib/search/api-service.ts";
import { publicationAnchorId } from "../../lib/shared/publication-identity.ts";
import { groupLabelForSearchResult } from "../../lib/shared/search-group.ts";
import { buildContentIndexes, extractSearchFieldsFromMdx } from "../../scripts/build/prebuild.mjs";
import { reasoningDriftReadingOrder } from "../../lib/posts/reasoning-drift-series.ts";

function publication(title, extra = {}) {
  return `<PublicationsEntry data='${JSON.stringify({ title, year: "2024", labels: [], ...extra })}' />`;
}

test("legacy publication anchors survive title edits, reordering and save/reopen", () => {
  const first = publication("AISDB", { doiUrl: "https://doi.org/10.1016/j.softx.2024.101952" });
  const second = publication("Paper without an external resource");
  const source = `${first}\n\n${second}`;
  const previous = parsePublicationsEntries(source).map(({ entryId }) => entryId);
  assert.deepEqual(parsePublicationsEntries(`${second}\n\n${first}`).map(({ entryId }) => entryId), previous.toReversed());
  const draft = parsePublicationsComponentDraft(source);
  draft.items[1].title = "Edited title";
  draft.items.reverse();
  const updated = parsePublicationsEntries(serializePublicationsComponentDraft(draft));
  assert.equal(updated[0].title, "Edited title");
  assert.deepEqual(updated.map(({ entryId }) => entryId), previous.toReversed());
  const duplicate = parsePublicationsEntries(`${first}\n\n${first}`);
  assert.notEqual(duplicate[0].entryId, duplicate[1].entryId);
  const literalTitle = "O'Reilly &quot; <title /> \\u0027";
  draft.items[0].title = literalTitle;
  assert.equal(parsePublicationsEntries(serializePublicationsComponentDraft(draft))[0].title, literalTitle);
});

test("public search points to individual papers, preserving route grouping and visibility", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-discovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["pages", "components", "filesystem"]) fs.mkdirSync(path.join(root, "content", dir), { recursive: true });
  const pubPage = path.join(root, "content/pages/publications.mdx");
  const pubs = [publication("AISDB maritime data", { doiUrl: "https://doi.org/10.1234/aisdb", venues: [{ type: "journal", text: "SoftwareX" }] }), publication("AISDB visualization")].join("\n\n");
  fs.writeFileSync(path.join(root, "content/components/publications.mdx"), pubs);
  fs.writeFileSync(pubPage, "---\ntitle: Publications\n---\n\n<PublicationsBlock />\n");
  const { routes, searchIndex } = buildContentIndexes(root);
  assert.deepEqual(routes.map(({ routePath }) => routePath), ["/publications"]);
  assert.equal(searchIndex.length, 1);
  const search = (q, overrides = {}) => buildSearchResponse({ q, type: "all", offset: 0, limit: 20,
    scope: "/publications", index: searchIndex, manifest: [], ...overrides });
  const [entry] = parsePublicationsEntries(pubs);
  const result = search(entry.title).items[0];
  assert.equal(result.routePath, `/publications#${publicationAnchorId(entry.entryId)}`);
  assert.equal(result.title, entry.title);
  assert.equal(result.breadcrumb, "Publications / 2024");
  assert.match(result.snippet, /SoftwareX/);
  assert.equal(groupLabelForSearchResult(result.kind, result.routePath), "Pages / Publications");
  assert.equal(search("AISDB").items.filter(({ routePath }) => routePath.includes("#paper-")).length, 2);
  assert.deepEqual(search("publications").items.map(({ routePath }) => routePath), ["/publications"]);
  assert.deepEqual(search("AISDB", { scope: "/blog" }).items, []);
  fs.writeFileSync(pubPage, "---\ntitle: Publications\n---\n\n<PublicationsBlock limit={1} />\n");
  assert.equal(buildContentIndexes(root).searchIndex[0].publications.length, 1);
  fs.writeFileSync(pubPage, "---\ntitle: Publications\ndraft: true\n---\n\n<PublicationsBlock />\n");
  assert.deepEqual(buildContentIndexes(root).searchIndex, []);
  fs.writeFileSync(pubPage, "---\ntitle: Publications\n---\n\n<PublicationsBlock />\n");
  fs.writeFileSync(path.join(root, "content/filesystem/protected-routes.json"), JSON.stringify([{ path: "/publications", mode: "exact", token: "fixture" }]));
  assert.deepEqual(buildContentIndexes(root).searchIndex, []);
});

test("Works affiliation repair is scoped to the observed legacy value and stable through saves", () => {
  const old = '<WorksEntry entryId="works-6" role="Technical Director" period="Oct 2017 - Sep 2018" affiliation="Sino Gateway Media &amp;amp;amp;amp; Marketing Ltd.">\nBody\n</WorksEntry>';
  const expected = "Sino Gateway Media & Marketing Ltd.";
  assert.equal(parseWorksEntries(old)[0].affiliation, expected);
  assert.ok(extractSearchFieldsFromMdx(old).text.includes(expected));
  const draft = parseWorksComponentDraft(old);
  assert.equal(draft.items[0].affiliation, expected);
  const saved = serializeWorksComponentDraft(draft);
  assert.match(saved, /Media &amp; Marketing/);
  assert.equal(parseWorksEntries(saved)[0].affiliation, expected);
  assert.equal(parseWorksEntries(old.replace("Sino Gateway", "Example"))[0].affiliation, "Example Media &amp;amp;amp; Marketing Ltd.");
});

test("reasoning drift reading order is independent of post order and omits absent posts", () => {
  const first = { slug: "when-ai-reasoning-starts-to-drift", href: "/blog/intro" };
  const third = { slug: "context-order-and-reasoning-drift-measuring-order-sensitivity-from-token-probabilities", href: "/blog/order" };
  assert.deepEqual(reasoningDriftReadingOrder([third, first]).map(({ href }) => href), [first.href, third.href]);
  assert.deepEqual(reasoningDriftReadingOrder([first]), []);
});
