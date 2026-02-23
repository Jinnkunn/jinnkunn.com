import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSitemapExcludeEntry,
  parseSitemapExcludeEntries,
} from "../lib/shared/sitemap-excludes.ts";

test("sitemap-excludes: normalize supports paths and notion ids", () => {
  assert.equal(normalizeSitemapExcludeEntry("teaching/archive/"), "/teaching/archive");
  assert.equal(
    normalizeSitemapExcludeEntry("https://www.notion.so/foo/bar-21040d70fdf580019476fa3c2ec769f2"),
    "21040d70fdf580019476fa3c2ec769f2",
  );
  assert.equal(
    normalizeSitemapExcludeEntry("/21040d70fdf580019476fa3c2ec769f2"),
    "21040d70fdf580019476fa3c2ec769f2",
  );
});

test("sitemap-excludes: parse splits comma/newline and dedupes", () => {
  const out = parseSitemapExcludeEntries(
    "/private\nteaching/archive, /private, 21040d70fdf580019476fa3c2ec769f2",
  );
  assert.deepEqual(out, [
    "/private",
    "/teaching/archive",
    "21040d70fdf580019476fa3c2ec769f2",
  ]);
});

