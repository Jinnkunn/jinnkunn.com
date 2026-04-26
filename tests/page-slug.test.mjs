import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isValidPageSlug,
  joinPageSlug,
  pageSlugLeaf,
  pageSlugParent,
} from "../lib/pages/slug.ts";

test("isValidPageSlug accepts flat single-segment slugs", () => {
  assert.equal(isValidPageSlug("about"), true);
  assert.equal(isValidPageSlug("a"), true);
  assert.equal(isValidPageSlug("hello-world-2"), true);
});

test("isValidPageSlug accepts hierarchical slugs up to 4 levels", () => {
  assert.equal(isValidPageSlug("docs/intro"), true);
  assert.equal(isValidPageSlug("docs/api/v1/auth"), true);
});

test("isValidPageSlug rejects 5+ levels", () => {
  assert.equal(isValidPageSlug("a/b/c/d/e"), false);
});

test("isValidPageSlug rejects leading / trailing / double slashes", () => {
  assert.equal(isValidPageSlug("/about"), false);
  assert.equal(isValidPageSlug("about/"), false);
  assert.equal(isValidPageSlug("docs//intro"), false);
});

test("isValidPageSlug rejects per-segment violations", () => {
  assert.equal(isValidPageSlug("Docs"), false); // uppercase
  assert.equal(isValidPageSlug("docs/-intro"), false); // leading dash
  assert.equal(isValidPageSlug("docs/intro_"), false); // underscore
  assert.equal(isValidPageSlug("docs/-"), false); // single dash
});

test("isValidPageSlug rejects empty / non-string", () => {
  assert.equal(isValidPageSlug(""), false);
  assert.equal(isValidPageSlug("//"), false);
});

test("pageSlugParent extracts parent path", () => {
  assert.equal(pageSlugParent("docs/api/auth"), "docs/api");
  assert.equal(pageSlugParent("docs/intro"), "docs");
  assert.equal(pageSlugParent("about"), null);
});

test("pageSlugLeaf returns last segment", () => {
  assert.equal(pageSlugLeaf("docs/api/auth"), "auth");
  assert.equal(pageSlugLeaf("about"), "about");
});

test("joinPageSlug stitches parent + leaf", () => {
  assert.equal(joinPageSlug("docs/api", "auth"), "docs/api/auth");
  assert.equal(joinPageSlug(null, "about"), "about");
  assert.equal(joinPageSlug("", "about"), "about");
});
