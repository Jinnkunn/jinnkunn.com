import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSitemapAutoExclude,
  parseSitemapSectionList,
  routePathDepth,
  sectionForRoutePath,
  shouldAutoExcludeFromSitemap,
} from "../lib/shared/sitemap-policy.ts";

test("sitemap-policy: sectionForRoutePath classifies sections", () => {
  assert.equal(sectionForRoutePath("/"), "pages");
  assert.equal(sectionForRoutePath("/blog/post-a"), "blog");
  assert.equal(sectionForRoutePath("/publications"), "publications");
  assert.equal(sectionForRoutePath("/teaching/archive"), "teaching");
});

test("sitemap-policy: routePathDepth counts path segments", () => {
  assert.equal(routePathDepth("/"), 0);
  assert.equal(routePathDepth("/teaching"), 1);
  assert.equal(routePathDepth("/teaching/archive/2024-25-fall"), 3);
});

test("sitemap-policy: parseSitemapSectionList filters invalid and dedupes", () => {
  assert.deepEqual(
    parseSitemapSectionList(" blog, teaching,unknown\nblog pages "),
    ["blog", "teaching", "pages"],
  );
});

test("sitemap-policy: normalizeSitemapAutoExclude sanitizes values", () => {
  const cfg = normalizeSitemapAutoExclude({
    enabled: true,
    excludeSections: ["blog", "bad", "blog"],
    maxDepthBySection: {
      teaching: 6,
      pages: -2,
      publications: "3",
      bad: 99,
    },
  });

  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.excludeSections, ["blog"]);
  assert.equal(cfg.maxDepthBySection.teaching, 6);
  assert.equal(cfg.maxDepthBySection.pages, 0);
  assert.equal(cfg.maxDepthBySection.publications, 3);
  assert.equal("bad" in cfg.maxDepthBySection, false);
});

test("sitemap-policy: shouldAutoExcludeFromSitemap applies section and depth rules", () => {
  const bySection = normalizeSitemapAutoExclude({
    enabled: true,
    excludeSections: ["blog"],
    maxDepthBySection: {},
  });
  assert.equal(shouldAutoExcludeFromSitemap("/blog/post-a", bySection), true);
  assert.equal(shouldAutoExcludeFromSitemap("/publications", bySection), false);

  const byDepth = normalizeSitemapAutoExclude({
    enabled: true,
    excludeSections: [],
    maxDepthBySection: { teaching: 5 },
  });
  assert.equal(shouldAutoExcludeFromSitemap("/teaching/archive/2024-25-fall/csci3141/timeline", byDepth), false);
  assert.equal(
    shouldAutoExcludeFromSitemap(
      "/teaching/archive/2024-25-fall/csci3141/timeline/assignment-1-posted",
      byDepth,
    ),
    true,
  );
});
