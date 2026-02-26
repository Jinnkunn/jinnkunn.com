import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSeoPageOverrides } from "../lib/shared/seo-page-overrides.ts";

test("seo-page-overrides: normalizes json text and route paths", () => {
  const out = normalizeSeoPageOverrides(
    '{"blog":{"title":"Blog"},"/private/":{"noindex":"true"},"bad key":{"title":"x"}}',
  );
  assert.deepEqual(out, {
    "/blog": { title: "Blog" },
    "/private": { noindex: true },
  });
});

test("seo-page-overrides: ignores invalid payloads", () => {
  assert.deepEqual(normalizeSeoPageOverrides("not-json"), {});
  assert.deepEqual(normalizeSeoPageOverrides(null), {});
  assert.deepEqual(normalizeSeoPageOverrides({ "/x": null }), {});
});
