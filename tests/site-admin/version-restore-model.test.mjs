import assert from "node:assert/strict";
import test from "node:test";
import { describeVersionRestore } from "../../app/site-admin/site-admin-version-model.ts";

test("version restore shows semantic fields from current editor to earlier draft", () => {
  const current = '---\ntitle: Current\ndescription: ""\ncustom: retained\n---\nCurrent body.';
  const earlier = '---\ntitle: Earlier\ndescription: ""\ncustom: retained\n---\nEarlier body.';
  const [change] = describeVersionRestore("content/posts/example.mdx", current, earlier);
  assert.equal(change.kind, "restore");
  assert.deepEqual(change.details.fields.map((field) => field.label), ["Title", "Content"]);
  assert.deepEqual(change.details.fields[0], { label: "Title", before: "Current", after: "Earlier" });
  assert.deepEqual(change.details.routes, ["/blog", "/blog/example"]);
  assert.deepEqual(describeVersionRestore("content/posts/example.mdx", current, current), []);
});

test("collection restore describes changed entries and Home/Now use their own fields", () => {
  const work = '<WorksEntry entryId="role-one" role="Engineer" period="Jan 2026 - Now">Body.</WorksEntry>';
  const [collection] = describeVersionRestore("content/components/works.mdx", work, work.replace("Engineer", "Researcher"));
  assert.equal(collection.details.entries[0].kind, "changed");
  assert.equal(collection.details.entries[0].fields[0].label, "Role");
  const [home] = describeVersionRestore("content/home.json", '{"title":"Home","bodyMdx":"New"}', '{"title":"Home","bodyMdx":"Old"}');
  assert.equal(home.details.fields[0].label, "Content");
  assert.deepEqual(home.details.routes, ["/"]);
  const [now] = describeVersionRestore("content/now.json", '{"current":{"text":"New"}}', '{"current":{"text":"Old"}}');
  assert.equal(now.details.fields[0].label, "Status");
});
