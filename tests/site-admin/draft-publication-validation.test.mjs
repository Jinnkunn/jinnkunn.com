import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePostFile } from "../../packages/content-core/src/posts-meta.ts";
import { parsePageFile } from "../../packages/content-core/src/pages-meta.ts";
import { assertDocumentDraftSource, documentSourceProblems } from "../../lib/shared/document-draft-validation.ts";
import { publicationValidation, assertPublicationReady } from "../../lib/shared/publication-validation.ts";
import { normalizeAnnouncement } from "../../lib/shared/announcements.ts";
import { writeSmokeTarget, assertIsolatedReview } from "../../scripts/qa/site-admin-write-smoke.mjs";

const incomplete = '---\ntitle: ""\ndate: ""\ndraft: true\n---\n';
test("incomplete drafts can save without inventing title, date or content", () => {
  assert.doesNotThrow(() => assertDocumentDraftSource(incomplete, "posts"));
  const parsed = parsePostFile("empty", incomplete, { allowIncomplete: true });
  assert.equal(parsed.frontmatter.title, ""); assert.equal(parsed.frontmatter.date, ""); assert.equal(parsed.entry.readingMinutes, 0);
  assert.throws(() => parsePostFile("empty", incomplete), /title/);
  assert.doesNotThrow(() => parsePageFile("empty", "", { allowIncomplete: true }));
  assert.throws(() => parsePageFile("empty", ""), /title/);
});
test("draft safety rejects malformed YAML, typed objects and dangerous image references", () => {
  for (const source of ['---\ntitle: [broken\n---', '---\n- value\n---', '---\ntitle: { nested: value }\n---', '---\ndraft: "true"\n---']) {
    assert.equal(documentSourceProblems(source)[0].field, "source");
    assert.throws(() => assertDocumentDraftSource(source, "posts"));
  }
  for (const cover of ["javascript:alert(1)", "//external.test/image.png", "https://user:pass@example.test/x", "/\\unsafe"]) {
    assert.throws(() => assertDocumentDraftSource(`---\ncover: ${JSON.stringify(cover)}\n---`, "posts"), /HTTP/);
  }
  assert.doesNotThrow(() => assertDocumentDraftSource('---\ncover: /media/cover.png\n---', "posts"));
});
test("hidden incomplete drafts warn while public incomplete drafts block publication", () => {
  const hidden = publicationValidation({ "posts/test.mdx": incomplete });
  assert.equal(hidden.blockers.length, 0); assert.deepEqual(hidden.warnings.map((issue) => issue.field), ["title", "date", "body"]);
  const visible = { "posts/test.mdx": incomplete.replace("draft: true", "draft: false") };
  assert.deepEqual(publicationValidation(visible).blockers.map((issue) => issue.field), ["title", "date", "body"]);
  assert.throws(() => assertPublicationReady({ sources: visible }), /PUBLICATION_VALIDATION_FAILED/);
  assert.equal(publicationValidation({ "posts/test.mdx": '---\ntitle: [broken\ndraft: true\n---' }).blockers[0].field, "source");
});
test("announcements preserve blank titles during draft saves but cannot publish incomplete content", () => {
  const draft = normalizeAnnouncement({ id: "draft", title: "", status: "draft", bodyMdx: "" });
  assert.equal(draft.title, "");
  const sources = (status) => ({ "filesystem/announcements.json": JSON.stringify({ version: 1, items: [{ ...draft, status }] }) });
  assert.equal(publicationValidation(sources("draft")).blockers.length, 0);
  assert.ok(publicationValidation(sources("published")).blockers.length >= 2);
});
test("write QA is read-only by default and refuses production, credentials and foreign hosts", () => {
  assert.equal(writeSmokeTarget([]).execute, false);
  assert.equal(writeSmokeTarget(["--execute"]).execute, true);
  assert.equal(writeSmokeTarget(["--execute", "--publisher=local"]).publisher, "local");
  assert.throws(() => writeSmokeTarget(["--publisher=other"]));
  for (const args of [["--env=production"], ["--env=prod"], ["--env=other"]]) assert.throws(() => writeSmokeTarget(args));
  for (const BASE_URL of ["https://jinkunchen.com", "https://staging.jinkunchen.com.evil.test", "https://user:pass@staging.jinkunchen.com", "http://staging.jinkunchen.com", "https://staging.jinkunchen.com/admin"]) assert.throws(() => writeSmokeTarget([], { BASE_URL }));
  const review = { snapshotSha: "a".repeat(64), changes: [{ path: "posts/owned.mdx", oldPath: "" }] };
  assert.doesNotThrow(() => assertIsolatedReview(review, "posts/owned.mdx"));
  assert.throws(() => assertIsolatedReview(review, "posts/other.mdx"));
  assert.throws(() => assertIsolatedReview({ ...review, validation: { blockers: [{}] } }, "posts/owned.mdx"));
});

test("publication validation runs before queueing, building and replacing a promoted overlay", () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const route = read("app/api/site-admin/release-jobs/route.ts");
  assert.ok(route.indexOf("const validation = publicationValidation") < route.indexOf("const out = await createReleaseJob"));
  assert.match(route, /status: 422, code: "PUBLICATION_VALIDATION_FAILED"/);
  const publisher = read("scripts/content/publish-content.mjs");
  assert.match(publisher, /if \(!auth.ok\)[\s\S]*STAGING_AUTH_UNAVAILABLE/);
  assert.match(publisher, /do not disable authentication/);
  assert.match(publisher, /assertPublicationReady\(publicationBaseline\)/);
  const copy = publisher.slice(publisher.indexOf("async function copyStagingOverlayToProduction"));
  assert.ok(copy.indexOf("assertPublicationReady(JSON.parse(baseline.body))") < copy.indexOf('sql: "DELETE FROM static_shell_overlays"'));
  const promotion = read("scripts/release/release-from-staging.mjs");
  assert.match(promotion, /validate-publication\.mjs", "--env=production"/);
  const announcements = read("app/api/site-admin/announcements/route.ts");
  assert.doesNotMatch(announcements, /Published announcements need body content|Path-scoped announcements need at least one route/);
});
