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
