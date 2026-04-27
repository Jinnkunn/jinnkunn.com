import test from "node:test";
import assert from "node:assert/strict";

import {
  SITE_COMPONENT_DEFINITIONS,
  getSiteComponentDefinition,
} from "../lib/site-admin/component-registry.ts";
import {
  findComponentUsagesInSources,
} from "../lib/components/usage.ts";
import {
  parseNewsEntries,
  parsePublicationsEntries,
  parseTeachingEntries,
  parseWorksEntries,
  summarizeComponentEntries,
} from "../lib/components/parse.ts";

test("components-system: registry defines the four shared collections", () => {
  assert.deepEqual(
    SITE_COMPONENT_DEFINITIONS.map((item) => item.name),
    ["news", "teaching", "publications", "works"],
  );
  assert.equal(getSiteComponentDefinition("news").embedTag, "NewsBlock");
  assert.equal(getSiteComponentDefinition("works").sourcePath, "content/components/works.mdx");
});

test("components-system: shared parsers extract collection entries", () => {
  const news = parseNewsEntries(`
---
title: "News"
---

<NewsEntry date="2026-01-02">
Newer
</NewsEntry>

<NewsEntry date="2025-12-31">
Older
</NewsEntry>
`);
  assert.deepEqual(news.map((entry) => entry.dateIso), ["2026-01-02", "2025-12-31"]);

  const teaching = parseTeachingEntries(
    '<TeachingEntry term="Fall" period="Sep-Dec" role="Instructor" courseCode="CSCI3141" courseName="Foundations" />',
  );
  assert.equal(teaching[0].courseCode, "CSCI3141");

  const publications = parsePublicationsEntries(
    '<PublicationsEntry data=\'{"title":"Paper","year":"2026","url":"","labels":[]}\' />',
  );
  assert.equal(publications[0].title, "Paper");

  const works = parseWorksEntries(
    '<WorksEntry category="passed" role="Researcher" period="2024">Body</WorksEntry>',
  );
  assert.equal(works[0].category, "passed");
  assert.equal(works[0].body, "Body");
});

test("components-system: usage graph maps embed tags to routes", () => {
  const usage = findComponentUsagesInSources([
    {
      kind: "page",
      sourcePath: "content/pages/news.mdx",
      routePath: "/news",
      title: "News",
      source: "<NewsBlock />",
    },
    {
      kind: "home",
      sourcePath: "content/home.json",
      routePath: "/",
      title: "Home",
      source: "<WorksBlock limit={2} />",
    },
  ]);
  assert.equal(usage.news[0].routePath, "/news");
  assert.equal(usage.works[0].routePath, "/");
  assert.deepEqual(usage.teaching, []);
});

test("components-system: entry summaries stay compact", () => {
  const summary = summarizeComponentEntries(
    "teaching",
    '<TeachingEntry term="Fall" period="Sep-Dec" role="Instructor" courseCode="CSCI3141" courseName="Foundations" courseUrl="/teaching/archive/course" />',
  );
  assert.equal(summary.count, 1);
  assert.equal(summary.rows[0].title, "CSCI3141 · Foundations");
  assert.equal(summary.rows[0].href, "/teaching/archive/course");
});
