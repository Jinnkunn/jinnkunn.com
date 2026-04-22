import assert from "node:assert/strict";
import test from "node:test";

import { shouldBlockUnsavedNavigation } from "../lib/site-admin/unsaved-navigation.ts";

test("site-admin-unsaved-navigation: blocks same-origin route changes when enabled", () => {
  assert.equal(
    shouldBlockUnsavedNavigation({
      enabled: true,
      currentHref: "https://example.com/site-admin/config",
      nextHref: "/site-admin/routes",
    }),
    true,
  );
});

test("site-admin-unsaved-navigation: ignores same URL, new tabs, and external links", () => {
  assert.equal(
    shouldBlockUnsavedNavigation({
      enabled: true,
      currentHref: "https://example.com/site-admin/config",
      nextHref: "https://example.com/site-admin/config",
    }),
    false,
  );

  assert.equal(
    shouldBlockUnsavedNavigation({
      enabled: true,
      currentHref: "https://example.com/site-admin/config",
      nextHref: "/site-admin/routes",
      target: "_blank",
    }),
    false,
  );

  assert.equal(
    shouldBlockUnsavedNavigation({
      enabled: true,
      currentHref: "https://example.com/site-admin/config",
      nextHref: "https://other.example.com/site-admin/routes",
    }),
    false,
  );
});

test("site-admin-unsaved-navigation: ignores modified clicks and disabled guard", () => {
  assert.equal(
    shouldBlockUnsavedNavigation({
      enabled: false,
      currentHref: "https://example.com/site-admin/config",
      nextHref: "/site-admin/routes",
    }),
    false,
  );

  assert.equal(
    shouldBlockUnsavedNavigation({
      enabled: true,
      currentHref: "https://example.com/site-admin/config",
      nextHref: "/site-admin/routes",
      metaKey: true,
    }),
    false,
  );

  assert.equal(
    shouldBlockUnsavedNavigation({
      enabled: true,
      currentHref: "https://example.com/site-admin/config",
      nextHref: "/site-admin/routes",
      button: 1,
    }),
    false,
  );
});
