import test from "node:test";
import assert from "node:assert/strict";
import { describePublicationChange } from "../../lib/shared/publication-review-details.ts";
import { publicationSnapshot, publicationReview } from "../../lib/shared/publication-snapshot.mjs";

function describe(path, before, after, extra = {}) {
  const baseline = publicationSnapshot({ ...extra, [path]: before });
  const current = publicationSnapshot({ ...extra, [path]: after });
  return describePublicationChange(publicationReview(current, baseline).changes[0], current, baseline);
}
test("home and document review exposes field differences, not raw JSON", () => {
  const details = describe("home.json", JSON.stringify({ title: "Home", bodyMdx: "Old biography" }), JSON.stringify({ title: "Home", bodyMdx: "New biography" }));
  assert.deepEqual(details.fields, [{ label: "Content", before: "Old biography", after: "New biography" }]);
  assert.deepEqual(details.routes, ["/"]);
});
test("new News rows are additions even when they share dates with legacy rows", () => {
  const old = '<NewsEntry date="2026-10-24">Existing news</NewsEntry>';
  const details = describe("components/news.mdx", old, `<NewsEntry date="2026-10-24">New news</NewsEntry>\n${old}`,
    { "pages/news.mdx": "<NewsBlock />", "home.json": JSON.stringify({ title: "Home", bodyMdx: "<NewsBlock />" }) });
  assert.equal(details.summary, "1 added");
  assert.equal(details.entries[0].fields.find((field) => field.label === "Content").after, "New news");
  assert.deepEqual(details.routes, ["/", "/news"]);
});
test("work category and period changes are field changes, with all component consumers", () => {
  const before = '<WorksEntry entryId="work-1" category="recent" role="Instructor" period="2025 - Now">Teaching</WorksEntry>';
  const after = before.replace('category="recent"', 'category="passed"').replace('2025 - Now', '2025 - 2026');
  const details = describe("components/works.mdx", before, after, { "pages/bio.mdx": "<BioExperienceBlock />" });
  assert.equal(details.summary, "1 changed");
  assert.deepEqual(details.entries[0].fields.map((field) => field.label).sort(), ["Group", "Period"]);
  assert.deepEqual(details.routes, ["/bio", "/works"]);
});
test("adding stable IDs to legacy News does not report every existing row as removed and added", () => {
  const old = '<NewsEntry date="2026-10-24">Existing news</NewsEntry>';
  const next = old.replace("<NewsEntry", '<NewsEntry entryId="existing"');
  const details = describe("components/news.mdx", old, `${next}<NewsEntry entryId="new" date="2026-10-24">New news</NewsEntry>`);
  assert.equal(details.summary, "1 added");
  assert.equal(details.entries.length, 1);
});
test("reordering is not confused with adding or deleting collection rows", () => {
  const a = '<TeachingEntry courseCode="A" term="2026/27 Fall Term" />';
  const b = '<TeachingEntry courseCode="B" term="2026/27 Fall Term" />';
  const details = describe("components/teaching.mdx", a + b, b + a);
  assert.equal(details.summary, "Order changed");
  assert.deepEqual(details.entries, []);
});
test("announcements review identifies content and display changes by announcement", () => {
  const a = { items: [{ id: "notice", title: "Notice", bodyMdx: "Old", scope: "home" }] };
  const b = { items: [{ ...a.items[0], bodyMdx: "New", scope: "all-public" }] };
  const details = describe("filesystem/announcements.json", JSON.stringify(a), JSON.stringify(b));
  assert.equal(details.siteWide, true);
  assert.equal(details.entries[0].title, "Notice");
  assert.deepEqual(details.entries[0].fields.map((field) => field.label), ["Content", "Display scope"]);
});
test("malformed or custom content keeps the advanced source fallback", () => {
  const details = describe("home.json", "not json", "still not json");
  assert.equal(details.summary, "Advanced source changed");
});
test("Now review shows status fields without duplicate current history or internal identifiers", () => {
  const before = { current: { text: "Before", updatedAt: "2026-10-23T12:00:00Z" }, updates: [] };
  const after = { current: { text: "After", updatedAt: "2026-10-24T12:00:00Z" }, links: [], updates: [{ id: "internal-id", text: "After", at: "2026-10-24T12:00:00Z" }] };
  const details = describe("now.json", JSON.stringify(before), JSON.stringify(after));
  assert.deepEqual(details.fields.map((field) => field.label), ["Status", "Date"]);
  assert.deepEqual(details.entries, []);
  assert.equal(JSON.stringify(details).includes("internal-id"), false);
});
