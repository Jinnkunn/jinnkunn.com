import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createLocalSiteAdminSourceStore,
  isSiteAdminSourceConflictError,
} from "../lib/server/site-admin-source-store.ts";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-admin-source-store-"));
  writeJson(path.join(root, "content", "generated", "site-config.json"), {
    siteName: "Fixture Site",
    lang: "en",
    seo: {
      title: "Fixture",
      description: "desc",
      favicon: "/favicon.ico",
    },
    nav: {
      top: [{ href: "/", label: "Home" }],
      more: [{ href: "/blog", label: "Blog" }],
    },
    content: {
      routeOverrides: {},
      sitemapExcludes: [],
      sitemapAutoExclude: {
        enabled: true,
        excludeSections: [],
        maxDepthBySection: {},
      },
    },
  });
  writeJson(path.join(root, "content", "generated", "protected-routes.json"), []);
  writeJson(path.join(root, "content", "generated", "routes-manifest.json"), []);
  return root;
}

test("site-admin-source-store: config save updates sourceVersion and writes filesystem source", async () => {
  const root = createFixtureRoot();
  const store = createLocalSiteAdminSourceStore({ rootDir: root });

  const before = await store.loadConfig();
  assert.equal(before.settings.siteName, "Fixture Site");
  assert.equal(before.nav.length, 2);
  assert.ok(before.sourceVersion.siteConfigSha);
  assert.ok(before.sourceVersion.branchSha);

  const afterVersion = await store.updateSettings({
    rowId: before.settings.rowId,
    patch: { siteName: "Updated Fixture Site" },
    expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
  });

  assert.notEqual(afterVersion.siteConfigSha, before.sourceVersion.siteConfigSha);

  const savedConfig = JSON.parse(
    fs.readFileSync(path.join(root, "content", "filesystem", "site-config.json"), "utf8"),
  );
  assert.equal(savedConfig.siteName, "Updated Fixture Site");
});

test("site-admin-source-store: local override keeps dev config outside tracked filesystem", async () => {
  const previous = process.env.SITE_CONTENT_LOCAL_OVERRIDES;
  process.env.SITE_CONTENT_LOCAL_OVERRIDES = "1";
  try {
    const root = createFixtureRoot();
    writeJson(path.join(root, "content", "local", "site-config.json"), {
      siteName: "Local Fixture Site",
      lang: "en",
      seo: {
        title: "Local Fixture",
        description: "local desc",
        favicon: "/favicon.ico",
      },
      nav: {
        top: [{ href: "/", label: "Home" }],
        more: [],
      },
      content: {
        routeOverrides: {},
        sitemapExcludes: [],
        sitemapAutoExclude: {
          enabled: true,
          excludeSections: [],
          maxDepthBySection: {},
        },
      },
    });
    const store = createLocalSiteAdminSourceStore({ rootDir: root });

    const before = await store.loadConfig();
    assert.equal(before.settings.siteName, "Local Fixture Site");

    await store.updateSettings({
      rowId: before.settings.rowId,
      patch: { siteName: "Updated Local Fixture Site" },
      expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
    });

    const localConfig = JSON.parse(
      fs.readFileSync(path.join(root, "content", "local", "site-config.json"), "utf8"),
    );
    assert.equal(localConfig.siteName, "Updated Local Fixture Site");
    assert.equal(
      fs.existsSync(path.join(root, "content", "filesystem", "site-config.json")),
      false,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SITE_CONTENT_LOCAL_OVERRIDES;
    } else {
      process.env.SITE_CONTENT_LOCAL_OVERRIDES = previous;
    }
  }
});

test("site-admin-source-store: stale expected sha returns SOURCE_CONFLICT", async () => {
  const root = createFixtureRoot();
  const store = createLocalSiteAdminSourceStore({ rootDir: root });

  const before = await store.loadConfig();
  await store.updateSettings({
    rowId: before.settings.rowId,
    patch: { siteName: "First Save" },
    expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
  });

  await assert.rejects(
    () =>
      store.updateSettings({
        rowId: before.settings.rowId,
        patch: { siteName: "Second Save" },
        expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
      }),
    (err) => {
      assert.equal(isSiteAdminSourceConflictError(err), true);
      if (isSiteAdminSourceConflictError(err)) {
        assert.equal(err.code, "SOURCE_CONFLICT");
      }
      return true;
    },
  );
});

test("site-admin-source-store: settings patch can opt into stale sha replay", async () => {
  const root = createFixtureRoot();
  const store = createLocalSiteAdminSourceStore({ rootDir: root });

  const before = await store.loadConfig();
  await store.updateSettings({
    rowId: before.settings.rowId,
    patch: { seoTitle: "Saved Elsewhere" },
    expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
  });

  await store.updateSettings({
    rowId: before.settings.rowId,
    patch: { googleAnalyticsId: "G-ABC123DEF4" },
    expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
    allowStaleSiteConfigSha: true,
  });

  const savedConfig = JSON.parse(
    fs.readFileSync(path.join(root, "content", "filesystem", "site-config.json"), "utf8"),
  );
  assert.equal(savedConfig.seo.title, "Saved Elsewhere");
  assert.equal(savedConfig.integrations.googleAnalyticsId, "G-ABC123DEF4");
});

test("site-admin-source-store: empty expected sha means file must not exist", async () => {
  const root = createFixtureRoot();
  const store = createLocalSiteAdminSourceStore({ rootDir: root });

  await store.writeTextFile({
    relPath: "content/example.json",
    content: "{}\n",
    expectedSha: "",
  });

  await assert.rejects(
    () =>
      store.writeTextFile({
        relPath: "content/example.json",
        content: "{\"changed\":true}\n",
        expectedSha: "",
      }),
    (err) => {
      assert.equal(isSiteAdminSourceConflictError(err), true);
      if (isSiteAdminSourceConflictError(err)) {
        assert.equal(err.code, "SOURCE_CONFLICT");
        assert.equal(err.expectedSha, "");
        assert.ok(err.currentSha);
      }
      return true;
    },
  );
});

test("site-admin-source-store: path-key protected routes write, preserve token, and delete", async () => {
  const root = createFixtureRoot();
  const store = createLocalSiteAdminSourceStore({ rootDir: root });

  const before = await store.loadRoutes();
  const firstVersion = await store.updateProtected({
    pageId: "",
    path: "/secret",
    mode: "prefix",
    auth: "password",
    password: "open-sesame",
    expectedProtectedRoutesSha: before.sourceVersion.protectedRoutesSha,
  });

  const protectedPath = path.join(root, "content", "filesystem", "protected-routes.json");
  const saved = JSON.parse(fs.readFileSync(protectedPath, "utf8"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "path");
  assert.equal(saved[0].pageId, "");
  assert.equal(saved[0].path, "/secret");
  assert.equal(saved[0].mode, "prefix");
  assert.equal(saved[0].auth, "password");
  assert.ok(saved[0].token);
  const token = saved[0].token;

  const loaded = await store.loadRoutes();
  assert.deepEqual(loaded.protectedRoutes, [
    {
      rowId: saved[0].id,
      pageId: "",
      path: "/secret",
      mode: "prefix",
      auth: "password",
      enabled: true,
    },
  ]);

  const secondVersion = await store.updateProtected({
    pageId: "",
    path: "/secret",
    mode: "prefix",
    auth: "password",
    password: "",
    expectedProtectedRoutesSha: firstVersion.protectedRoutesSha,
  });
  const preserved = JSON.parse(fs.readFileSync(protectedPath, "utf8"));
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0].token, token);

  await store.updateProtected({
    pageId: "",
    path: "/secret",
    mode: "prefix",
    auth: "password",
    password: "",
    delete: true,
    expectedProtectedRoutesSha: secondVersion.protectedRoutesSha,
  });
  const deleted = JSON.parse(fs.readFileSync(protectedPath, "utf8"));
  assert.deepEqual(deleted, []);
});
