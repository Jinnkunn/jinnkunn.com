import test from "node:test";
import assert from "node:assert/strict";
import matter from "gray-matter";
import { formFromEditablePayload, sourceForEditedContent, restoreDocumentForm } from "../../app/site-admin/site-admin-document-model.ts";

const source = '---\n# Preserve this note\ntitle: Original # keep title note\ndate: 2026-10-26\ndescription: ""\ntags: ["research, methods", ai]\ncustomSeo:\n  canonical: /original\n  flags: [one, two]\n---\n\nA long paragraph that must not become an explicitly empty description.\n\n';
test("opening and saving an untouched document preserves exact source bytes", () => {
  for (const original of [source, source.replace(/\n/g, "\r\n"), "Body without frontmatter\n"]) {
    const form = formFromEditablePayload("posts", "test", { source: original });
    assert.equal(sourceForEditedContent("posts", form), original);
  }
});
test("body edits leave the complete original header intact", () => {
  const form = formFromEditablePayload("posts", "test", { source });
  const updated = sourceForEditedContent("posts", { ...form, body: "New body with trailing spaces.  \n" });
  assert.equal(updated.slice(0, updated.indexOf("New body")), source.slice(0, source.length - form.body.length));
  assert.ok(updated.endsWith("spaces.  \n"));
  assert.deepEqual(matter(updated).data.tags, ["research, methods", "ai"]);
});
test("metadata edits preserve unknown nested fields, comments and empty values", () => {
  const form = formFromEditablePayload("posts", "test", { source });
  const updated = sourceForEditedContent("posts", { ...form, title: "Changed title" });
  assert.equal(matter(updated).data.title, "Changed title");
  assert.deepEqual(matter(updated).data.customSeo, matter(source).data.customSeo);
  assert.equal(matter(updated).data.description, "");
  assert.ok(updated.includes("# Preserve this note")); assert.ok(updated.includes("# keep title note"));
});
test("explicitly empty or missing descriptions never hydrate from computed summaries", () => {
  for (const original of [source, source.replace('description: ""\n', "")]) {
    const form = formFromEditablePayload("posts", "test", { source: original, description: "Computed summary" });
    assert.equal(form.description, "");
    const updated = sourceForEditedContent("posts", { ...form, title: "Edited title" });
    assert.equal(Object.hasOwn(matter(updated).data, "description"), original.includes("description:"));
  }
});
test("clearing optional fields is retained and a new header can be added", () => {
  const page = formFromEditablePayload("pages", "test", { source: '---\ntitle: Page\nupdated: 2026-10-26\ndescription: Before\n---\nBody' });
  const updated = matter(sourceForEditedContent("pages", { ...page, updated: "", description: "" })).data;
  assert.equal(updated.updated, ""); assert.equal(updated.description, "");
  const empty = formFromEditablePayload("posts", "new", { source: "Body" });
  assert.equal(matter(sourceForEditedContent("posts", { ...empty, title: "New", date: "2026-10-26" })).data.title, "New");
});
test("older recovery copies retain their original unknown metadata", () => {
  const form = formFromEditablePayload("posts", "test", { source });
  delete form.sourceBase;
  const restored = restoreDocumentForm("posts", { ...form, title: "Recovered" }, source);
  assert.deepEqual(matter(sourceForEditedContent("posts", restored)).data.customSeo, matter(source).data.customSeo);
});
