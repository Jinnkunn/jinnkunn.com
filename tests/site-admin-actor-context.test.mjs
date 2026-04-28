// Verifies the actor flows from runWithSiteAdminActor() all the way through
// the file backend into DbContentStore.upsert's updated_by column. Pinning
// this end-to-end gives confidence the audit trail won't silently regress
// when someone refactors withSiteAdminContext or adds a new entry point.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
  getCurrentSiteAdminActor,
  runWithSiteAdminActor,
} from "../lib/server/site-admin-actor-context.ts";
import {
  createDbFileBackend,
} from "../lib/server/site-admin-file-backend.ts";
import {
  createLocalSiteAdminSourceStore,
} from "../lib/server/site-admin-source-store.ts";

const SCHEMA_PATH = path.join(process.cwd(), "migrations/001_content_files.sql");

async function makeStore() {
  const client = createClient({ url: ":memory:" });
  const schema = await readFile(SCHEMA_PATH, "utf8");
  await client.executeMultiple(schema);
  // Seed the structured config rows so updateSettings has something to read.
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
  await seed("filesystem/site-config.json", {
    siteName: "Fixture",
    nav: { top: [], more: [] },
  });
  await seed("filesystem/protected-routes.json", []);
  await seed("filesystem/routes-manifest.json", []);

  const backend = createDbFileBackend({
    executor: client,
    getActor: getCurrentSiteAdminActor,
  });
  const store = createLocalSiteAdminSourceStore({ backend });
  return { client, store };
}

test("actor-context: getCurrentSiteAdminActor() returns null outside a run scope", () => {
  assert.equal(getCurrentSiteAdminActor(), null);
});

test("actor-context: runWithSiteAdminActor() sets the value for the inner scope only", () => {
  const observed = runWithSiteAdminActor("alice", () => getCurrentSiteAdminActor());
  assert.equal(observed, "alice");
  assert.equal(getCurrentSiteAdminActor(), null);
});

test("actor-context: blank actor leaves the store empty (no \"\" rows)", () => {
  const observedEmpty = runWithSiteAdminActor("", () => getCurrentSiteAdminActor());
  const observedSpace = runWithSiteAdminActor("   ", () => getCurrentSiteAdminActor());
  assert.equal(observedEmpty, null);
  assert.equal(observedSpace, null);
});

test("actor-context: write inside a run scope stamps updated_by in D1", async () => {
  const { client, store } = await makeStore();
  const before = await store.loadConfig();

  await runWithSiteAdminActor("alice", async () => {
    await store.updateSettings({
      rowId: before.settings.rowId,
      patch: { siteName: "After Alice" },
      expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
    });
  });

  const row = await client.execute({
    sql: "SELECT updated_by FROM content_files WHERE rel_path = ?",
    args: ["filesystem/site-config.json"],
  });
  assert.equal(row.rows[0].updated_by, "alice");
});

test("actor-context: write outside any scope falls back to null updated_by", async () => {
  const { client, store } = await makeStore();
  const before = await store.loadConfig();

  await store.updateSettings({
    rowId: before.settings.rowId,
    patch: { siteName: "Anonymous" },
    expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
  });

  const row = await client.execute({
    sql: "SELECT updated_by FROM content_files WHERE rel_path = ?",
    args: ["filesystem/site-config.json"],
  });
  assert.equal(row.rows[0].updated_by, null);
});

test("actor-context: concurrent writes preserve their own actor (no ALS bleed)", async () => {
  const { client, store } = await makeStore();

  // Queue two writes whose async work overlaps, each in its own ALS scope.
  // If ALS leaked across scopes one write would see the other's actor.
  const writeOne = runWithSiteAdminActor("alice", async () => {
    await new Promise((r) => setTimeout(r, 10));
    return store.writeTextFile({
      relPath: "content/filesystem/notes-alice.json",
      content: '{"who":"alice"}\n',
      expectedSha: "",
    });
  });
  const writeTwo = runWithSiteAdminActor("bob", async () => {
    await new Promise((r) => setTimeout(r, 5));
    return store.writeTextFile({
      relPath: "content/filesystem/notes-bob.json",
      content: '{"who":"bob"}\n',
      expectedSha: "",
    });
  });

  await Promise.all([writeOne, writeTwo]);

  const aliceRow = await client.execute({
    sql: "SELECT updated_by FROM content_files WHERE rel_path = ?",
    args: ["filesystem/notes-alice.json"],
  });
  const bobRow = await client.execute({
    sql: "SELECT updated_by FROM content_files WHERE rel_path = ?",
    args: ["filesystem/notes-bob.json"],
  });
  assert.equal(aliceRow.rows[0].updated_by, "alice");
  assert.equal(bobRow.rows[0].updated_by, "bob");
});
