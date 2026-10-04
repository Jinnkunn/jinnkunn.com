import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionHistory, commitCollectionDraft, undoCollectionDraft, redoCollectionDraft,
  parseCollectionDraft, serializeCollectionDraft, groupCollectionItems,
} from "../../app/site-admin/site-admin-collection-draft.ts";
import { WORKS_ENTRY_FIELDS, PUBLICATION_ENTRY_FIELDS } from "../../app/site-admin/site-admin-structured-collection-schema.ts";
import { formatTeachingTerm, parseTeachingTerm, teachingAcademicYears } from "../../app/site-admin/site-admin-teaching-term.ts";
import { teachingEntryIssues } from "../../app/site-admin/site-admin-structured-collection-model.ts";

const works = { name: "works", value: { frontmatter: "---\ntitle: Works\n---", items: [
  { id: "work-one", category: "recent", role: "Instructor", period: "", body: "" },
] } };

test("structured draft keeps unfinished input, and coalesces typing for undo", () => {
  const next = (role) => ({ ...works, value: { ...works.value, items: [{ ...works.value.items[0], role }] } });
  let history = collectionHistory(works);
  history = commitCollectionDraft(history, next("Part-time "), "edit:work-one");
  history = commitCollectionDraft(history, next("Part-time Instructor "), "edit:work-one");
  assert.equal(history.present.value.items[0].role, "Part-time Instructor ");
  assert.equal(history.past.length, 1);
  assert.deepEqual(undoCollectionDraft(history).present, works);
  assert.deepEqual(redoCollectionDraft(undoCollectionDraft(history)).present, history.present);
  history = commitCollectionDraft({ ...history, group: "" }, next("New role"), "edit:work-one");
  assert.equal(history.past.length, 2);
});

test("deletion and ordering are reversible; a new edit discards the redo branch", () => {
  const deleted = { ...works, value: { ...works.value, items: [] } };
  const history = commitCollectionDraft(collectionHistory(works), deleted);
  const undone = undoCollectionDraft(history);
  assert.deepEqual(undone.present, works);
  assert.deepEqual(redoCollectionDraft(undone).present, deleted);
  assert.equal(commitCollectionDraft(undone, { ...works, value: { ...works.value, frontmatter: "new" } }).future.length, 0);
  assert.deepEqual(groupCollectionItems([
    { id: "a", term: "Winter" }, { id: "b", term: "Fall" }, { id: "c", term: "Winter" },
  ], (item) => item.term).map((item) => item.id), ["a", "c", "b"]);
});

test("month range preserves end-first and incomplete selections until serialization", () => {
  const field = WORKS_ENTRY_FIELDS.find((item) => item.key === "period");
  const item = field.writeRange(works.value.items[0], { start: "", end: "2026-02", ongoing: false, valid: true });
  assert.equal(item.period, "");
  assert.equal(field.readRange(item).end, "2026-02");
  const complete = field.writeRange(item, { ...field.readRange(item), start: "2025-11" });
  assert.equal(complete.period, "Nov 2025 – Feb 2026");
  const source = serializeCollectionDraft({ ...works, value: { ...works.value, items: [complete] } });
  assert.ok(!source.includes("periodRange"));
});

test("attribute entities round-trip exactly once without corrupting editable text", () => {
  const item = { ...works.value.items[0], role: 'R&D "Platform" <team> &quot;', period: "Nov 2025 - Now" };
  let draft = { ...works, value: { ...works.value, items: [item] } };
  for (let index = 0; index < 3; index += 1) {
    draft = parseCollectionDraft("works", serializeCollectionDraft(draft));
    assert.equal(draft.value.items[0].role, item.role);
    assert.equal(draft.value.items[0].id, item.id);
  }
});

test("author tokens preserve punctuation and rich author metadata", () => {
  const authors = PUBLICATION_ENTRY_FIELDS.find((item) => item.key === "authors");
  const publication = { id: "pub", title: "Paper", year: "2026", labels: [], authorsRich: [
    { name: "Chen, Jinkun", isSelf: true, url: "https://example.com/" },
  ] };
  const changed = authors.writeList(publication, ["Chen, Jinkun", "Another Person"]);
  assert.deepEqual(changed.authors, ["Chen, Jinkun", "Another Person"]);
  assert.deepEqual(changed.authorsRich[0], publication.authorsRich[0]);
  const selfAuthor = PUBLICATION_ENTRY_FIELDS.find((item) => item.key === "selfAuthor");
  assert.equal(selfAuthor.write(changed, "Another Person").authorsRich[0].url, "https://example.com/");
});

test("Teaching terms use academic year and season, retaining custom historic labels", () => {
  assert.equal(formatTeachingTerm("2026/27", "Winter"), "2026/27 Winter Term");
  assert.deepEqual(parseTeachingTerm("2026/27 Winter Term"), { year: "2026/27", season: "Winter" });
  assert.equal(parseTeachingTerm("Special course "), null);
  assert.ok(teachingAcademicYears(2026, "1980/81").includes("1980/81"));
});

test("Teaching cannot save an unfinished standard term or month range", () => {
  const item = { id: "course", term: "2026/27", courseCode: "CSCI QA", courseName: "", period: "", role: "", instructor: "" };
  assert.equal(teachingEntryIssues(item)[0].field, "term");
  const completeTerm = { ...item, term: "2026/27 Winter Term" };
  assert.deepEqual(teachingEntryIssues(completeTerm), []);
  assert.equal(teachingEntryIssues({ ...completeTerm, periodRange: { start: "", end: "2027-04", ongoing: false, valid: true } })[0].field, "period");
  assert.equal(teachingEntryIssues({ ...completeTerm, periodRange: { start: "2027-01", end: "", ongoing: false, valid: true } })[0].field, "period");
  assert.deepEqual(teachingEntryIssues({ ...completeTerm, term: "Special course " }), []);
});
