import test from "node:test";
import assert from "node:assert/strict";

import {
  extractNextBuildIdFromHtml,
  extractNextStaticRefs,
} from "../../scripts/content/publish-content.mjs";

test("content publish keeps route-group chunks in the static asset set", () => {
  assert.deepEqual(
    extractNextStaticRefs(
      '<script src="/_next/static/chunks/app/(classic)/layout-f527bdab78160e01.js"></script>',
    ),
    ["/_next/static/chunks/app/(classic)/layout-f527bdab78160e01.js"],
  );
});

test("content publish reads a Pages Router build id from static manifests", () => {
  assert.equal(
    extractNextBuildIdFromHtml(
      '<script src="/_next/static/pages-router-123/_buildManifest.js"></script>',
    ),
    "pages-router-123",
  );
});

test("content publish reads an App Router build id from the RSC bootstrap", () => {
  assert.equal(
    extractNextBuildIdFromHtml(
      '<script>self.__next_f.push([1,"0:{\\\"P\\\":null,\\\"b\\\":\\\"app-router-456\\\"}"])</script>',
    ),
    "app-router-456",
  );
});

test("content publish tolerates an unescaped Next bootstrap payload", () => {
  assert.equal(
    extractNextBuildIdFromHtml('<script type="application/json">{"b":"plain-789"}</script>'),
    "plain-789",
  );
});

test("content publish does not invent a build id", () => {
  assert.equal(extractNextBuildIdFromHtml("<main>No Next bootstrap</main>"), "");
});
