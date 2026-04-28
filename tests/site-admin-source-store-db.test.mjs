// Mirrors the local-fs tests in site-admin-source-store.test.mjs, but injects
// a libSQL-backed file backend so the same SiteAdminSourceStore implementation
// is exercised end-to-end against a real SQLite database. This is the proof
// that LocalSiteAdminSourceStore-with-DbFileBackend is functionally equivalent
// to LocalSiteAdminSourceStore-with-FsFileBackend, which is the whole point
// of the Phase 3a refactor.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
  createLocalSiteAdminSourceStore,
  isSiteAdminSourceConflictError,
} from "../lib/server/site-admin-source-store.ts";
import { createDbFileBackend } from "../lib/server/site-admin-file-backend.ts";

const SCHEMA_PATH = path.join(process.cwd(), "migrations/001_content_files.sql");

const FIXTURE_SITE_CONFIG = {
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
};

async function makeStore({ seedConfig = true } = {}) {
  const client = createClient({ url: ":memory:" });
  const schema = await readFile(SCHEMA_PATH, "utf8");
  await client.executeMultiple(schema);

  if (seedConfig) {
    // Seed both the filesystem source and the routes manifest so the store
    // sees the same starting state the on-disk fixture provides.
    const seed = (relPath, value) =>
      client.execute({
        sql: `INSERT INTO content_files (rel_path, body, sha, size, is_binary, updated_at, updated_by)
              VALUES (?, ?, ?, ?, 0, ?, 'test-fixture')`,
        args: [
          relPath,
          new Uint8Array(Buffer.from(JSON.stringify(value), "utf8")),
          "fixture-sha",
          Buffer.byteLength(JSON.stringify(value), "utf8"),
          Date.now(),
        ],
      });
    await seed("filesystem/site-config.json", FIXTURE_SITE_CONFIG);
    await seed("filesystem/protected-routes.json", []);
    await seed("filesystem/routes-manifest.json", []);
  }

  const backend = createDbFileBackend({ executor: client });
  const store = createLocalSiteAdminSourceStore({ backend });
  return { client, store };
}

test("db-source-store: kind is 'db' when backend is db", async () => {
  const { store } = await makeStore();
  assert.equal(store.kind, "db");
  const state = await store.getSourceState();
  assert.equal(state.storeKind, "db");
});

test("db-source-store: loadConfig surfaces seeded site config", async () => {
  const { store } = await makeStore();
  const snapshot = await store.loadConfig();
  assert.equal(snapshot.settings.siteName, "Fixture Site");
  assert.equal(snapshot.nav.length, 2);
  assert.ok(snapshot.sourceVersion.siteConfigSha);
  assert.ok(snapshot.sourceVersion.branchSha);
});

test("db-source-store: updateSettings persists to D1 and bumps sourceVersion", async () => {
  const { client, store } = await makeStore();
  const before = await store.loadConfig();

  const next = await store.updateSettings({
    rowId: before.settings.rowId,
    patch: { siteName: "Updated Site" },
    expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
  });
  assert.notEqual(next.siteConfigSha, before.sourceVersion.siteConfigSha);

  const refreshed = await store.loadConfig();
  assert.equal(refreshed.settings.siteName, "Updated Site");

  // Verify the bytes really landed in D1, not just in some in-memory cache.
  const row = await client.execute({
    sql: "SELECT body FROM content_files WHERE rel_path = ?",
    args: ["filesystem/site-config.json"],
  });
  const stored = JSON.parse(Buffer.from(row.rows[0].body).toString("utf8"));
  assert.equal(stored.siteName, "Updated Site");
});

test("db-source-store: updateSettings with stale sha throws SiteAdminSourceConflictError", async () => {
  const { store } = await makeStore();
  const before = await store.loadConfig();

  await store.updateSettings({
    rowId: before.settings.rowId,
    patch: { siteName: "First Update" },
    expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
  });

  await assert.rejects(
    () =>
      store.updateSettings({
        rowId: before.settings.rowId,
        patch: { siteName: "Second Update" },
        expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
      }),
    (err) => isSiteAdminSourceConflictError(err),
  );
});

test("db-source-store: createNavRow appends and round-trips through the DB", async () => {
  const { store } = await makeStore();
  const before = await store.loadConfig();
  const result = await store.createNavRow({
    row: {
      label: "Notes",
      href: "/notes",
      group: "more",
      order: 99,
      enabled: true,
    },
    expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
  });
  assert.equal(result.created.label, "Notes");
  assert.match(result.created.rowId, /^[0-9a-f]+$/);

  const refreshed = await store.loadConfig();
  const found = refreshed.nav.find((row) => row.rowId === result.created.rowId);
  assert.ok(found, "new nav row should be visible after reload");
  assert.equal(found.href, "/notes");
});

test("db-source-store: updateProtected writes protected-routes.json to D1", async () => {
  const { client, store } = await makeStore();
  const before = await store.loadRoutes();

  await store.updateProtected({
    pageId: "p-private",
    path: "/private",
    mode: "exact",
    auth: "password",
    password: "hunter2",
    expectedProtectedRoutesSha: before.sourceVersion.protectedRoutesSha,
  });

  const row = await client.execute({
    sql: "SELECT body FROM content_files WHERE rel_path = ?",
    args: ["filesystem/protected-routes.json"],
  });
  const stored = JSON.parse(Buffer.from(row.rows[0].body).toString("utf8"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].path, "/private");
  assert.equal(stored[0].mode, "exact");
});

test("db-source-store: writeTextFile + readTextFile round-trip arbitrary repo paths", async () => {
  const { store } = await makeStore({ seedConfig: false });

  const created = await store.writeTextFile({
    relPath: "content/publications.json",
    content: '{"hello":"world"}\n',
    expectedSha: "",
  });
  assert.match(created.fileSha, /^[a-f0-9]{40}$/);

  const read = await store.readTextFile("content/publications.json");
  assert.equal(read?.content, '{"hello":"world"}\n');
  assert.equal(read?.sha, created.fileSha);
});

test("db-source-store: writeTextFile with stale expectedSha throws SiteAdminSourceConflictError", async () => {
  const { store } = await makeStore({ seedConfig: false });
  const first = await store.writeTextFile({
    relPath: "content/publications.json",
    content: "v1",
    expectedSha: "",
  });
  await assert.rejects(
    () =>
      store.writeTextFile({
        relPath: "content/publications.json",
        content: "v2",
        expectedSha: "bogus-sha",
      }),
    (err) => isSiteAdminSourceConflictError(err),
  );
  // Sanity: the correct sha still works.
  const second = await store.writeTextFile({
    relPath: "content/publications.json",
    content: "v2",
    expectedSha: first.fileSha,
  });
  assert.notEqual(second.fileSha, first.fileSha);
});

test("db-source-store: history methods stub to empty / null on db backend", async () => {
  const { store } = await makeStore({ seedConfig: false });
  const history = await store.listTextFileHistory("content/publications.json", 12);
  assert.deepEqual(history, []);
  const atCommit = await store.readTextFileAtCommit(
    "content/publications.json",
    "deadbeef",
  );
  assert.equal(atCommit, null);
});

test("db-source-store: rejects writes outside content/ prefix", async () => {
  const { store } = await makeStore({ seedConfig: false });
  await assert.rejects(
    () =>
      store.writeTextFile({
        relPath: "outside/file.json",
        content: "x",
        expectedSha: "",
      }),
    /db file backend: path must be under content\//,
  );
});
