import assert from "node:assert/strict";
import test from "node:test";
import { publicationCandidate, publicationScopeOptions } from "../../lib/shared/publication-scope.ts";
import { assertPublicationSnapshot, publicationSnapshot } from "../../lib/shared/publication-snapshot.mjs";
import { publicationValidation } from "../../lib/shared/publication-validation.ts";
import { readPublicationsDocument } from "@jinnkunn/content-core/publications";
import { describePublicationChange } from "../../lib/shared/publication-review-details.ts";

const news = "components/news.mdx", post = "posts/example.mdx";
const header = '---\ntitle: Example\ndate: 2026-03-21\n---\n\n';
const row = (id, body) => `<NewsEntry ${id ? `entryId="${id}" ` : ""}date="2026-03-21">\n\n${body}\n\n</NewsEntry>`;
const baseline = publicationSnapshot({
  [news]: `---\ntitle: News\n---\n\n${row("", "Old entry A")}\n\n---\n\n${row("", "Old entry B")}\n`,
  [post]: `${header}Published post.`,
});

test("single News selection does not publish another entry or a broken unrelated draft", () => {
  const draftNews = `---\ntitle: News\n---\n\n${row("new", "Selected entry")}\n\n${row("news-1", "Unpublished revision to A")}\n\n${row("news-2", "Old entry B")}\n`;
  const saved = publicationSnapshot({ ...baseline.sources, [news]: draftNews, [post]: '---\ntitle: ""\n---\n' });
  assert.ok(publicationScopeOptions(saved, baseline).some((option) => option.id === "news:new"));
  const selected = publicationCandidate(saved, baseline, "news:new");
  assert.equal(selected.sources[post], baseline.sources[post]);
  assert.match(selected.sources[news], /Selected entry/);
  assert.doesNotMatch(selected.sources[news], /Unpublished revision/);
  assert.ok(selected.sources[news].includes(`${row("news-1", "Old entry A")}\n\n---\n\n${row("news-2", "Old entry B")}`));
  assert.match(publicationCandidate(saved, selected, "news:news-1").sources[news], /Unpublished revision to A/);
  assert.equal(publicationValidation(selected.sources).blockers.length, 0);
  assert.ok(publicationValidation(saved.sources).blockers.length > 0);
  const again = publicationSnapshot({ ...saved.sources, [post]: `${header}Unrelated edit.` });
  assert.equal(publicationCandidate(again, baseline, "news:new").sha, selected.sha);
  const stale = publicationSnapshot({ ...again.sources, [news]: draftNews.replace("Selected entry", "Another version") });
  assert.throws(() => assertPublicationSnapshot(publicationCandidate(stale, baseline, "news:new"), selected.sha), /SNAPSHOT_CHANGED/);
});

test("single document edits preserve Live and refuse route changes or links to an unpublished dependency", () => {
  const changed = publicationSnapshot({ ...baseline.sources, [post]: `${header}Revised body.`, "pages/not-live.mdx": `---\ntitle: Not live\n---\n` });
  assert.deepEqual(publicationCandidate(changed, baseline, `document:${post}`).sources, { ...baseline.sources, [post]: `${header}Revised body.` });
  const linked = publicationSnapshot({ ...changed.sources, [post]: `${header}[Reference](/not-live#new)` });
  assert.throws(() => publicationCandidate(linked, baseline, `document:${post}`), /references unpublished content/);
  const retitled = publicationSnapshot({ ...changed.sources, [post]: changed.sources[post].replace("title: Example", "title: Updated title\ndescription: Updated description") });
  assert.deepEqual(publicationCandidate(retitled, baseline, `document:${post}`).sources, { ...baseline.sources, [post]: retitled.sources[post] });
  const hidden = publicationSnapshot({ ...changed.sources, [post]: changed.sources[post].replace("title: Example", "title: Example\ndraft: true") });
  assert.throws(() => publicationCandidate(hidden, baseline, `document:${post}`), /affects site structure/);
  assert.equal(publicationCandidate(linked, baseline, "all").sha, linked.sha);
});

test("single Teaching edits preserve Live neighbors and require a stable group and order", () => {
  const file = "components/teaching.mdx";
  const course = (id, name, term = "2026/27 Fall Term", url = "") =>
    `<TeachingEntry entryId="${id}" term="${term}" courseCode="${id.toUpperCase()}" courseName="${name}"${url ? ` courseUrl="${url}"` : ""} />`;
  const a = course("a", "Live course A"), b = course("b", "Live course B");
  const edited = course("a", "Updated course A");
  const live = publicationSnapshot({ ...baseline.sources, [file]: `${header}${a}\n\n${b}\n` });
  const save = (...courses) => publicationSnapshot({ ...live.sources, [file]: `${header}${courses.join("\n\n")}\n` });
  const draft = save(edited, course("b", "Draft course B"));
  const selected = publicationCandidate(draft, live, "teaching:a");
  assert.equal(selected.sources[file], `${header}${edited}\n\n${b}\n`);
  assert.deepEqual(publicationScopeOptions(draft, live).map(({ id }) => id), [`document:${file}`, "teaching:a", "teaching:b"]);
  assert.throws(() => publicationCandidate(save(b, edited), live, "teaching:a"), /Reordering/);
  assert.throws(() => publicationCandidate(save(course("a", "Moved course", "2026/27 Winter Term"), b), live, "teaching:a"), /between groups/);
  assert.throws(() => publicationCandidate(save(b), live, "teaching:a"), /no longer exists/);
  assert.throws(() => publicationCandidate(save(a, edited, b), live, "teaching:a"), /unique stable IDs/);
  const appended = course("c", "New course");
  assert.equal(publicationCandidate(save(a, course("b", "Draft course B"), appended), live, "teaching:c").sources[file],
    `${header}${a}\n\n${b}\n\n${appended}\n`);
  assert.throws(() => publicationCandidate(save(a, appended), live, "teaching:c"), /ordering or deletion/);
  const linked = save(course("a", "Updated course A", "2026/27 Fall Term", "/class-materials"), b);
  const linkedDraft = publicationSnapshot({ ...linked.sources, "pages/class-materials.mdx": header });
  assert.throws(() => publicationCandidate(linkedDraft, live, "teaching:a"), /references unpublished content/);
});

test("single Works body edits leave nearby draft deletions and surrounding source unpublished", () => {
  const file = "components/works.mdx";
  const entry = (id, body) => `<WorksEntry entryId="${id}" category="recent" role="Role ${id}">\n\n${body}\n\n</WorksEntry>`;
  const first = entry("one", "Live role body");
  const second = entry("two", "Leave this role public");
  const edited = entry("one", "Updated body");
  const live = publicationSnapshot({ [file]: `${header}Live introduction.\n\n${first}\n\n${second}\n` });
  const saved = publicationSnapshot({ [file]: `${header}Unpublished introduction.\n\n${edited}\n` });
  assert.equal(publicationCandidate(saved, live, "works:one").sources[file], live.sources[file].replace(first, edited));
  assert.equal(publicationScopeOptions(saved, live).some(({ id }) => id === "works:two"), false);
});

test("single Publications edit preserves legacy anchors and unrelated saved papers", () => {
  const file = "components/publications.mdx";
  const legacy = (entry) => `<PublicationsEntry data='${JSON.stringify(entry)}' />`;
  const live = publicationSnapshot({
    "pages/bio.mdx": "---\ntitle: BIO\n---\n",
    [file]: `${header}${legacy({ title: "Live paper A", year: "2026" })}\n\n${legacy({ title: "Live paper B", year: "2025" })}\n`,
  });
  const doc = readPublicationsDocument(live.sources[file], { strict: true });
  const [a, b] = doc.entries;
  const draftA = { ...a, title: "Updated paper A" };
  const build = (entries) => publicationSnapshot({ ...live.sources, [file]: JSON.stringify({ ...doc, entries }) });
  const saved = build([draftA, { ...b, title: "Unpublished paper B" }]);
  const scope = `publications:${a.entryId}`;
  assert.ok(publicationScopeOptions(saved, live).some(({ id }) => id === scope));
  const candidate = publicationCandidate(saved, live, scope);
  assert.deepEqual(readPublicationsDocument(candidate.sources[file]).entries, [draftA, b]);
  const change = { path: file, oldPath: "", before: live.sources[file], after: candidate.sources[file] };
  assert.deepEqual(describePublicationChange(change, candidate, live).routes, ["/bio", "/publications"]);
  assert.throws(() => publicationCandidate(build([{ ...draftA, year: "2024" }, b]), live, scope), /between groups/);
});
