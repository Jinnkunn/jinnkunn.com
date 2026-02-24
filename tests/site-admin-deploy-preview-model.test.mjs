import test from "node:test";
import assert from "node:assert/strict";

import { buildDeployPreviewDiff } from "../lib/site-admin/deploy-preview-model.ts";

test("deploy-preview-model: computes added/removed/redirect/protected changes", () => {
  const out = buildDeployPreviewDiff({
    currentRoutes: [
      { pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", routePath: "/home", title: "Home" },
      { pageId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", routePath: "/old", title: "Old" },
    ],
    liveRoutes: [
      { pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", routePath: "/home-new", title: "Home" },
      { pageId: "cccccccccccccccccccccccccccccccc", routePath: "/new", title: "New" },
    ],
    currentOverrides: {
      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: "/home",
    },
    liveOverrides: {
      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: "/home-new",
      cccccccccccccccccccccccccccccccc: "/new",
    },
    currentProtected: [
      {
        pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        path: "/private",
        mode: "exact",
        auth: "password",
      },
    ],
    liveProtected: [
      {
        pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        path: "/private",
        mode: "prefix",
        auth: "github",
      },
      {
        pageId: "cccccccccccccccccccccccccccccccc",
        path: "/new/private",
        mode: "exact",
        auth: "github",
      },
    ],
  });

  assert.equal(out.hasChanges, true);
  assert.equal(out.summary.pagesAdded, 1);
  assert.equal(out.summary.pagesRemoved, 1);
  assert.equal(out.summary.redirectsAdded, 1);
  assert.equal(out.summary.redirectsRemoved, 0);
  assert.equal(out.summary.redirectsChanged, 1);
  assert.equal(out.summary.protectedAdded, 1);
  assert.equal(out.summary.protectedRemoved, 0);
  assert.equal(out.summary.protectedChanged, 1);

  assert.deepEqual(out.samples.pagesAdded, ["/new"]);
  assert.deepEqual(out.samples.pagesRemoved, ["/old"]);
});

test("deploy-preview-model: returns no changes for identical snapshots", () => {
  const out = buildDeployPreviewDiff({
    currentRoutes: [
      { pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", routePath: "/home", title: "Home" },
    ],
    liveRoutes: [
      { pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", routePath: "/home", title: "Home" },
    ],
    currentOverrides: {},
    liveOverrides: {},
    currentProtected: [],
    liveProtected: [],
  });

  assert.equal(out.hasChanges, false);
  assert.equal(out.summary.pagesAdded, 0);
  assert.equal(out.summary.pagesRemoved, 0);
  assert.equal(out.summary.redirectsAdded, 0);
  assert.equal(out.summary.redirectsRemoved, 0);
  assert.equal(out.summary.redirectsChanged, 0);
  assert.equal(out.summary.protectedAdded, 0);
  assert.equal(out.summary.protectedRemoved, 0);
  assert.equal(out.summary.protectedChanged, 0);
  assert.deepEqual(out.samples.pagesAdded, []);
  assert.deepEqual(out.samples.pagesRemoved, []);
  assert.deepEqual(out.samples.redirects, []);
  assert.deepEqual(out.samples.protected, []);
});
