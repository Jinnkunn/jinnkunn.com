import assert from "node:assert/strict";
import test from "node:test";
import { publicationCandidate, publicationScopeOptions } from "../../lib/shared/publication-scope.ts";
import { assertPublicationSnapshot, publicationSnapshot } from "../../lib/shared/publication-snapshot.mjs";
import { publicationValidation } from "../../lib/shared/publication-validation.ts";

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
  const hidden = publicationSnapshot({ ...changed.sources, [post]: changed.sources[post].replace("title: Example", "title: Example\ndraft: true") });
  assert.throws(() => publicationCandidate(hidden, baseline, `document:${post}`), /affects site structure/);
  assert.equal(publicationCandidate(linked, baseline, "all").sha, linked.sha);
});
