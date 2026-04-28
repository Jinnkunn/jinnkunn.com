// Pins the wire shape the Tauri sync engine relies on. Specifically:
//   - bodyHex is lowercase hex of the raw bytes (no JSON re-encoding)
//   - rows are returned in (updated_at ASC, rel_path ASC) order
//   - nextSince advances to the last row's updated_at
//   - hasMore=true when the result hits the limit (so the client knows
//     to immediately re-pull from nextSince)
//   - `since` filters strictly greater (>) so a watermark-equal row
//     isn't re-delivered next pull
//   - missing executor (no D1 binding configured) returns a structured
//     DB_BACKEND_UNAVAILABLE error instead of throwing

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import { pullSyncBatch } from "../lib/server/site-admin-sync-service.ts";

const SCHEMA_PATHS = [
  path.join(process.cwd(), "migrations/001_content_files.sql"),
];

async function makeExecutor() {
  const client = createClient({ url: ":memory:" });
  for (const p of SCHEMA_PATHS) {
    const schema = await readFile(p, "utf8");
    await client.executeMultiple(schema);
  }
  return client;
}

async function seed(client, rows) {
  for (const row of rows) {
    const bytes = new Uint8Array(Buffer.from(row.body, "utf8"));
    await client.execute({
      sql: `INSERT INTO content_files
              (rel_path, body, sha, size, is_binary, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.relPath,
        bytes,
        row.sha,
        bytes.byteLength,
        row.isBinary ? 1 : 0,
        row.updatedAt,
        row.updatedBy ?? null,
      ],
    });
  }
}

test("sync pull: returns empty batch when DB is empty, nextSince echoes input", async () => {
  const client = await makeExecutor();
  const result = await pullSyncBatch({ since: 0, limit: 10, executor: client });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, []);
  assert.equal(result.nextSince, 0);
  assert.equal(result.hasMore, false);
});

test("sync pull: returns rows in (updated_at ASC, rel_path ASC) order", async () => {
  const client = await makeExecutor();
  await seed(client, [
    { relPath: "posts/c.mdx", body: "ccc", sha: "sha-c", updatedAt: 1000, updatedBy: "u1" },
    { relPath: "posts/a.mdx", body: "aaa", sha: "sha-a", updatedAt: 1000, updatedBy: "u1" },
    { relPath: "posts/b.mdx", body: "bbb", sha: "sha-b", updatedAt: 2000, updatedBy: "u2" },
  ]);
  const result = await pullSyncBatch({ since: 0, limit: 10, executor: client });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.rows.map((r) => r.relPath),
    ["posts/a.mdx", "posts/c.mdx", "posts/b.mdx"],
    "ties on updated_at break by rel_path; otherwise ASC by updated_at",
  );
  assert.equal(result.nextSince, 2000);
  assert.equal(result.hasMore, false);
});

test("sync pull: bodyHex is lowercase hex of the raw bytes", async () => {
  const client = await makeExecutor();
  await seed(client, [
    { relPath: "posts/x.mdx", body: "Hi", sha: "sha-x", updatedAt: 1000 },
  ]);
  const result = await pullSyncBatch({ since: 0, limit: 10, executor: client });
  assert.equal(result.ok, true);
  // 'H' = 0x48, 'i' = 0x69
  assert.equal(result.rows[0].bodyHex, "4869");
});

test("sync pull: since filters strictly greater (>) — watermark row not re-delivered", async () => {
  const client = await makeExecutor();
  await seed(client, [
    { relPath: "posts/a.mdx", body: "aaa", sha: "sha-a", updatedAt: 1000 },
    { relPath: "posts/b.mdx", body: "bbb", sha: "sha-b", updatedAt: 2000 },
  ]);
  const result = await pullSyncBatch({ since: 1000, limit: 10, executor: client });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].relPath, "posts/b.mdx");
});

test("sync pull: hits limit -> hasMore=true, nextSince at last delivered row", async () => {
  const client = await makeExecutor();
  await seed(client, [
    { relPath: "posts/a.mdx", body: "a", sha: "sha-a", updatedAt: 1000 },
    { relPath: "posts/b.mdx", body: "b", sha: "sha-b", updatedAt: 2000 },
    { relPath: "posts/c.mdx", body: "c", sha: "sha-c", updatedAt: 3000 },
  ]);
  const result = await pullSyncBatch({ since: 0, limit: 2, executor: client });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextSince, 2000);

  // Drain remainder.
  const next = await pullSyncBatch({ since: 2000, limit: 2, executor: client });
  assert.equal(next.ok, true);
  assert.equal(next.rows.length, 1);
  assert.equal(next.rows[0].relPath, "posts/c.mdx");
  assert.equal(next.hasMore, false);
});

test("sync pull: clamps invalid limit to default + max", async () => {
  const client = await makeExecutor();
  await seed(client, [
    { relPath: "posts/a.mdx", body: "a", sha: "sha-a", updatedAt: 1000 },
  ]);
  const negative = await pullSyncBatch({ since: 0, limit: -5, executor: client });
  const huge = await pullSyncBatch({ since: 0, limit: 999_999, executor: client });
  const nan = await pullSyncBatch({ since: 0, limit: Number.NaN, executor: client });
  // All should still return the row without crashing.
  assert.equal(negative.ok, true);
  assert.equal(huge.ok, true);
  assert.equal(nan.ok, true);
});

test("sync pull: surfaces is_binary + updated_by faithfully", async () => {
  const client = await makeExecutor();
  await seed(client, [
    {
      relPath: "public/uploads/x.png",
      body: "fakebytes",
      sha: "sha-png",
      updatedAt: 1000,
      isBinary: true,
      updatedBy: "alice",
    },
    {
      relPath: "posts/y.mdx",
      body: "text",
      sha: "sha-y",
      updatedAt: 2000,
      updatedBy: null,
    },
  ]);
  const result = await pullSyncBatch({ since: 0, limit: 10, executor: client });
  assert.equal(result.ok, true);
  const png = result.rows.find((r) => r.relPath === "public/uploads/x.png");
  const mdx = result.rows.find((r) => r.relPath === "posts/y.mdx");
  assert.equal(png?.isBinary, true);
  assert.equal(png?.updatedBy, "alice");
  assert.equal(mdx?.isBinary, false);
  assert.equal(mdx?.updatedBy, null);
});

test("sync pull: missing executor (no D1 binding) returns DB_BACKEND_UNAVAILABLE", async () => {
  const result = await pullSyncBatch({ since: 0, limit: 10 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "DB_BACKEND_UNAVAILABLE");
    assert.match(result.error, /SITE_ADMIN_DB/);
  }
});
