import test from "node:test";
import assert from "node:assert/strict";

import {
  isSiteAdminDeployPreviewOk,
  parseSiteAdminDeployPreviewResult,
} from "../lib/site-admin/deploy-preview-contract.ts";

test("site-admin-deploy-preview-contract: parses valid success payload", () => {
  const out = parseSiteAdminDeployPreviewResult({
    ok: true,
    generatedAt: "2026-02-24T00:00:00.000Z",
    hasChanges: true,
    summary: {
      pagesAdded: 1,
      pagesRemoved: 0,
      redirectsAdded: 1,
      redirectsRemoved: 0,
      redirectsChanged: 1,
      protectedAdded: 1,
      protectedRemoved: 0,
      protectedChanged: 0,
    },
    samples: {
      pagesAdded: ["/new"],
      pagesRemoved: [],
      redirects: [
        {
          kind: "changed",
          source: "route",
          pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          title: "Home",
          fromPath: "/home",
          toPath: "/home-new",
        },
      ],
      protected: [
        {
          kind: "added",
          pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          path: "/private",
          mode: "exact",
          auth: "github",
        },
      ],
    },
  });
  assert.ok(out);
  assert.equal(isSiteAdminDeployPreviewOk(out), true);
  if (!out || !out.ok) return;
  assert.equal(out.summary.pagesAdded, 1);
  assert.equal(out.samples.redirects.length, 1);
});

test("site-admin-deploy-preview-contract: parses success payload in data envelope", () => {
  const out = parseSiteAdminDeployPreviewResult({
    ok: true,
    data: {
      generatedAt: "2026-02-24T00:00:00.000Z",
      hasChanges: true,
      summary: {
        pagesAdded: 1,
        pagesRemoved: 0,
        redirectsAdded: 1,
        redirectsRemoved: 0,
        redirectsChanged: 1,
        protectedAdded: 1,
        protectedRemoved: 0,
        protectedChanged: 0,
      },
      samples: {
        pagesAdded: ["/new"],
        pagesRemoved: [],
        redirects: [
          {
            kind: "changed",
            source: "route",
            pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            title: "Home",
            fromPath: "/home",
            toPath: "/home-new",
          },
        ],
        protected: [
          {
            kind: "added",
            pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            path: "/private",
            mode: "exact",
            auth: "github",
          },
        ],
      },
    },
  });
  assert.ok(out);
  assert.equal(isSiteAdminDeployPreviewOk(out), true);
  if (!out || !out.ok) return;
  assert.equal(out.summary.pagesAdded, 1);
  assert.equal(out.samples.redirects.length, 1);
});

test("site-admin-deploy-preview-contract: parses error payload", () => {
  const out = parseSiteAdminDeployPreviewResult({
    ok: false,
    error: "Unauthorized",
  });
  assert.ok(out);
  assert.equal(out?.ok, false);
});
