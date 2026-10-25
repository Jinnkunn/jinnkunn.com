import test from "node:test";
import assert from "node:assert/strict";
import { pagePreviewContext, resolvePreviewEmbeds } from "../../lib/site-admin/page-preview-context.ts";
import { announcementProblems, announcementInitiallyExpanded, announcementVisibleOnRoute, normalizeAnnouncement } from "../../lib/shared/announcements.ts";
const notice = normalizeAnnouncement({ id: "notice", title: "Notice", status: "published", bodyMdx: "Published text", compactMdx: "Summary", scope: "paths", routes: ["/news"], initialState: "route-aware" });

test("page preview context honors announcement route scope and dates", () => {
  const sources = { "filesystem/announcements.json": JSON.stringify({ version: 1, items: [notice] }) };
  assert.equal(pagePreviewContext(sources, "/news", undefined, new Date("2026-10-24")).announcement.bodyMdx, "Published text");
  assert.equal(pagePreviewContext(sources, "/", undefined, new Date("2026-10-24")).announcement, null);
  assert.equal(pagePreviewContext({ "filesystem/announcements.json": JSON.stringify({ version: 1, items: [{ ...notice, startsAt: "2027-01-01" }] }) }, "/news", undefined, new Date("2026-10-24")).announcement, null);
  assert.equal(announcementVisibleOnRoute(notice, "/news/archive"), true);
  assert.equal(announcementVisibleOnRoute(notice, "/newsletter"), false);
  assert.equal(announcementInitiallyExpanded(notice, true), true);
  assert.equal(announcementInitiallyExpanded(notice, false), false);
});
test("unsaved announcement previews use the candidate without changing its saved visibility", () => {
  const candidate = { ...notice, status: "draft", bodyMdx: "Unsaved candidate" };
  assert.equal(pagePreviewContext({}, "/news", candidate).announcement.bodyMdx, "Unsaved candidate");
  assert.equal(candidate.status, "draft");
});
test("preview uses published monochrome schedule and scope", () => {
  const sources = { "filesystem/site-config.json": JSON.stringify({ appearance: { monochrome: { enabled: true, scope: "home", desaturateMedia: true } } }) };
  assert.equal(pagePreviewContext(sources, "/").monochrome.enabled, true);
  assert.equal(pagePreviewContext(sources, "/news").monochrome, null);
});
test("embed preview takes the supplied publication snapshot and leaves code fences intact", () => {
  const sources = { "components/news.mdx": "---\ntitle: News\n---\n<NewsEntry date=\"2026-10-24\">Published item</NewsEntry>" };
  const source = "<NewsBlock />\n\n```mdx\n<NewsBlock />\n```";
  const resolved = resolvePreviewEmbeds(source, sources);
  assert.ok(resolved.includes("Published item"));
  assert.ok(resolved.endsWith("```mdx\n<NewsBlock />\n```"));
  assert.equal(resolved.includes("title: News"), false);
});
test("announcement validation maps path and date problems to actual fields", () => {
  assert.deepEqual(announcementProblems({ ...notice, startsAt: "2026-02-30", endsAt: "2025-01-01", routes: ["//example.test"] }).map((issue) => issue.field), ["routes", "startsAt", "endsAt"]);
  assert.equal(announcementProblems({ ...notice, bodyMdx: "" })[0].field, "bodyMdx");
});
