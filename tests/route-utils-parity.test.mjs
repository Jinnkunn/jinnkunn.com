import test from "node:test";
import assert from "node:assert/strict";

import * as routeUtilsTs from "../lib/shared/route-utils.ts";
import * as routeUtilsMjs from "../lib/shared/route-utils.mjs";

test("route-utils parity: ts and mjs exports stay behaviorally aligned", () => {
  const compactIdInputs = [
    "",
    "  ",
    "8d6dfeef-4c7f-4d67-8b48-99d2198877cb",
    "https://notion.so/test-8d6dfeef4c7f4d678b4899d2198877cb",
  ];
  for (const input of compactIdInputs) {
    assert.equal(routeUtilsTs.compactId(input), routeUtilsMjs.compactId(input));
  }

  const slugifyInputs = ["Hello, World!", "  Multi   Space  ", "A_B-C", "中文标题"];
  for (const input of slugifyInputs) {
    assert.equal(routeUtilsTs.slugify(input), routeUtilsMjs.slugify(input));
  }

  const normalizeRouteInputs = ["", " / ", "blog/post-a/", "/foo//", "/"];
  for (const input of normalizeRouteInputs) {
    assert.equal(routeUtilsTs.normalizeRoutePath(input), routeUtilsMjs.normalizeRoutePath(input));
  }

  const canonicalizeRouteInputs = [
    "",
    "/blog/list",
    "/blog/list/post-a",
    "/list",
    "/list/post-a",
    "/publications",
  ];
  for (const input of canonicalizeRouteInputs) {
    assert.equal(
      routeUtilsTs.canonicalizeRoutePath(input),
      routeUtilsMjs.canonicalizeRoutePath(input),
    );
  }

  const dashifyInputs = [
    "",
    "8d6dfeef4c7f4d678b4899d2198877cb",
    "8d6dfeef-4c7f-4d67-8b48-99d2198877cb",
    "invalid",
  ];
  for (const input of dashifyInputs) {
    assert.equal(routeUtilsTs.dashify32(input), routeUtilsMjs.dashify32(input));
  }
});
