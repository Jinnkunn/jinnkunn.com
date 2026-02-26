import test from "node:test";
import assert from "node:assert/strict";

import {
  isSiteAdminConfigGetOk,
  isSiteAdminConfigPostOk,
  parseSiteAdminConfigGet,
  parseSiteAdminConfigPost,
} from "../lib/site-admin/config-contract.ts";

function makeSettings() {
  return {
    rowId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    siteName: "Jinkun Chen.",
    lang: "en",
    seoTitle: "Jinkun Chen",
    seoDescription: "Research and publications",
    favicon: "/favicon.ico",
    ogImage: "/assets/profile.png",
    googleAnalyticsId: "G-XXXX",
    contentGithubUsers: "jinnkunn",
    sitemapExcludes: "",
    sitemapAutoExcludeEnabled: true,
    sitemapAutoExcludeSections: "blog",
    sitemapAutoExcludeDepthPages: "",
    sitemapAutoExcludeDepthBlog: "",
    sitemapAutoExcludeDepthPublications: "",
    sitemapAutoExcludeDepthTeaching: "",
    rootPageId: "root",
    homePageId: "home",
  };
}

function makeNav() {
  return [
    {
      rowId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      label: "Home",
      href: "/",
      group: "top",
      order: 0,
      enabled: true,
    },
  ];
}

test("site-admin-config-contract: parses get payload in data envelope", () => {
  const parsed = parseSiteAdminConfigGet({
    ok: true,
    data: {
      settings: makeSettings(),
      nav: makeNav(),
    },
  });
  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminConfigGetOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.settings?.siteName, "Jinkun Chen.");
  assert.equal(parsed.nav.length, 1);
});

test("site-admin-config-contract: parses post payload in data envelope", () => {
  const parsed = parseSiteAdminConfigPost({
    ok: true,
    data: {
      created: makeNav()[0],
    },
  });
  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminConfigPostOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.created?.label, "Home");
});

test("site-admin-config-contract: preserves error payload", () => {
  const parsed = parseSiteAdminConfigGet({ ok: false, error: "Unauthorized" });
  assert.deepEqual(parsed, { ok: false, error: "Unauthorized", code: "REQUEST_FAILED" });
});

