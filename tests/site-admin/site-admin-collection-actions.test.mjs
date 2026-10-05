import assert from "node:assert/strict";
import test from "node:test";
import { createCollectionActions } from "../../app/site-admin/site-admin-collection-actions.ts";
import { collectionHistory, undoCollectionDraft } from "../../app/site-admin/site-admin-collection-draft.ts";

function fixture(name, items) {
  let history = collectionHistory({ name, value: { frontmatter: `---\ntitle: ${name}\n---`, items } });
  let expanded = [], search = "";
  const actions = createCollectionActions({
    setCollectionHistory: (next) => { history = typeof next === "function" ? next(history) : next; },
    setComponentExpandedIds: (next) => { expanded = typeof next === "function" ? next(expanded) : next; },
    setComponentSearch: (next) => { search = next; }, selectedComponentName: name, componentSearch: "", teachingTerm: "2026/27 Winter Term",
  });
  return { actions, state: () => ({ history, expanded, search }) };
}
test("Teaching new courses inherit the term without normalizing unfinished inputs", () => {
  const { actions, state } = fixture("teaching", []);
  actions.addTeachingEntry();
  const entry = state().history.present.value.items[0];
  assert.equal(entry.term, "2026/27 Winter Term");
  actions.updateTeachingItem({ ...entry, courseCode: "CSCI " });
  assert.equal(state().history.present.value.items[0].courseCode, "CSCI ");
  assert.deepEqual(state().expanded, [entry.id]);
});
test("Works can cross groups; delete, undo and duplicate preserve entry data", () => {
  const entries = [{ id: "recent", category: "recent", role: "Intern", period: "Nov 2025 - Now", body: "Text" }, { id: "past", category: "passed", role: "Analyst", period: "2024", body: "Past" }];
  const { actions, state } = fixture("works", entries);
  actions.reorderSelectedComponentItems("recent", "past");
  assert.equal(state().history.present.value.items.find((entry) => entry.id === "recent").category, "passed");
  actions.duplicateWorksItem("recent");
  const copy = state().history.present.value.items.find((entry) => !["recent", "past"].includes(entry.id));
  assert.equal(copy.body, "Text");
  actions.deleteWorksItem(copy.id);
  assert.ok(undoCollectionDraft(state().history).present.value.items.some((entry) => entry.id === copy.id));
});
test("News and publication operations stay in their selected collection", () => {
  const { actions, state } = fixture("news", []);
  actions.addPublicationEntry();
  assert.deepEqual(state().history.present.value.items, []);
  actions.addNewsEntry();
  const item = state().history.present.value.items[0];
  actions.updateNewsItem({ ...item, body: "A new item " });
  assert.equal(state().history.present.value.items[0].body, "A new item ");
});

test("Teaching group defaults apply to new courses, without copying course-specific fields", () => {
  const initial = [{ id: "one", term: "2026/27 Winter Term", role: "Instructor", period: "Jan 2027 - Apr 2027", courseCode: "CSCI1000", courseName: "Existing", url: "https://example.test" }];
  const { actions, state } = fixture("teaching", initial);
  actions.addTeachingEntry("2026/27 Winter Term");
  const course = state().history.present.value.items[0];
  assert.equal(course.role, "Instructor");
  assert.equal(course.period, "Jan 2027 - Apr 2027");
  assert.equal(course.courseCode, "");
  assert.equal(course.url, undefined);
  actions.addTeachingEntry("2026/27 Winter Term", { role: "Assistant ", period: "Feb 2027" });
  assert.equal(state().history.present.value.items[0].role, "Assistant ");
  assert.deepEqual(state().history.present.value.items[2], initial[0]);
});

test("renaming a Teaching term is atomic, scoped and only fills empty fields on request", () => {
  const initial = [
    { id: "one", term: "2026/27 Fall Term", role: "Instructor", period: "Sep 2026 - Dec 2026", courseCode: "CSCI1000" },
    { id: "two", term: "2026/27 Fall Term", role: "", period: "", courseCode: "CSCI1001" },
    { id: "other", term: "2025/26 Fall Term", role: "", period: "", courseCode: "CSCI1002" },
  ];
  const { actions, state } = fixture("teaching", initial);
  const defaults = { role: "Assistant", period: "Jan 2027 - Apr 2027" };
  actions.updateTeachingTerm("2026/27 Fall Term", "2026/27 Winter Term", defaults);
  assert.equal(state().history.present.value.items[1].role, "");
  assert.deepEqual(undoCollectionDraft(state().history).present.value.items, initial);
  actions.updateTeachingTerm("2026/27 Winter Term", "2026/27 Winter Term", defaults, true);
  const rows = state().history.present.value.items;
  assert.equal(rows[0].period, initial[0].period);
  assert.equal(rows[0].role, initial[0].role);
  assert.equal(rows[1].role, "Assistant");
  assert.equal(rows[1].period, defaults.period);
  assert.deepEqual(rows[2], initial[2]);
});

test("work group moves preserve content and can be undone as one operation", () => {
  const initial = [{ id: "one", category: "recent", role: "Intern", body: "Body", period: "Nov 2025 - Now" }, { id: "two", category: "recent", role: "Instructor" }, { id: "old", category: "passed", role: "Analyst" }];
  const { actions, state } = fixture("works", initial);
  actions.moveWorksGroup("recent", "passed");
  assert.ok(state().history.present.value.items.every((item) => item.category === "passed"));
  assert.equal(state().history.present.value.items[0].period, initial[0].period);
  assert.deepEqual(undoCollectionDraft(state().history).present.value.items, initial);
});

test("publication year changes preserve advanced author metadata and leave other years alone", () => {
  const initial = [{ id: "one", title: "Paper", year: "2026", authorsRich: [{ name: "Doe, Jane", url: "https://example.test", isSelf: true }], labels: ["conference"] }, { id: "other", title: "Older", year: "2025" }];
  const { actions, state } = fixture("publications", initial);
  actions.updatePublicationYear("2026", "2027");
  assert.deepEqual(state().history.present.value.items[0], { ...initial[0], year: "2027" });
  assert.deepEqual(state().history.present.value.items[1], initial[1]);
  assert.deepEqual(undoCollectionDraft(state().history).present.value.items, initial);
});
