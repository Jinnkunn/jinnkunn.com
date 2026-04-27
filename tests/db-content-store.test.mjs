import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
} from "../lib/server/content-store.ts";
import { createDbContentStore } from "../lib/server/db-content-store.ts";

const SCHEMA_PATH = path.join(process.cwd(), "migrations/001_content_files.sql");

// Each test gets its own in-memory libSQL DB so cases stay isolated.
// libSQL is just a SQLite implementation here — production runs against D1
// (see lib/server/d1-executor.ts). The Client.execute shape happens to satisfy
// DbExecutor structurally, so we pass it straight through.
async function makeStore(opts) {
  const client = createClient({ url: ":memory:" });
  const schema = await readFile(SCHEMA_PATH, "utf8");
  await client.executeMultiple(schema);
  const store = createDbContentStore({ executor: client, ...opts });
  return { client, store };
}

test("db-content-store: empty list when nothing matches", async () => {
  const { store } = await makeStore();
  assert.deepEqual(await store.listFiles("posts"), []);
});

test("db-content-store: lists files non-recursively (excludes subdirs)", async () => {
  const { store } = await makeStore();
  await store.writeFile("posts/a.mdx", "hello a", { ifMatch: null });
  await store.writeFile("posts/b.mdx", "hello b", { ifMatch: null });
  await store.writeFile("posts/sub/c.mdx", "nested", { ifMatch: null });

  const files = await store.listFiles("posts");
  assert.deepEqual(
    files.map((f) => f.name),
    ["a.mdx", "b.mdx"],
  );
  for (const f of files) {
    assert.match(f.sha, /^[a-f0-9]{40}$/);
    assert.ok(f.size > 0);
  }
});

test("db-content-store: lists files recursively when requested", async () => {
  const { store } = await makeStore();
  await store.writeFile("posts/a.mdx", "x", { ifMatch: null });
  await store.writeFile("posts/sub/b.mdx", "y", { ifMatch: null });
  await store.writeFile("posts/sub/deep/c.mdx", "z", { ifMatch: null });

  const files = await store.listFiles("posts", { recursive: true });
  assert.deepEqual(
    files.map((f) => f.relPath).sort(),
    ["posts/a.mdx", "posts/sub/b.mdx", "posts/sub/deep/c.mdx"],
  );
});

test("db-content-store: write with ifMatch=null creates; second create rejects", async () => {
  const { store } = await makeStore();
  const written = await store.writeFile("posts/foo.mdx", "body", {
    ifMatch: null,
  });
  assert.match(written.sha, /^[a-f0-9]{40}$/);
  await assert.rejects(
    () => store.writeFile("posts/foo.mdx", "body2", { ifMatch: null }),
    ContentStoreConflictError,
  );
});

test("db-content-store: update requires correct ifMatch sha", async () => {
  const { store } = await makeStore();
  const first = await store.writeFile("posts/foo.mdx", "v1", { ifMatch: null });
  await assert.rejects(
    () => store.writeFile("posts/foo.mdx", "v2", { ifMatch: "bogus" }),
    ContentStoreConflictError,
  );
  const updated = await store.writeFile("posts/foo.mdx", "v2", {
    ifMatch: first.sha,
  });
  assert.notEqual(updated.sha, first.sha);
  const read = await store.readFile("posts/foo.mdx");
  assert.equal(read?.content, "v2");
});

test("db-content-store: read returns content + sha; null on missing", async () => {
  const { store } = await makeStore();
  await store.writeFile("posts/foo.mdx", "hello", { ifMatch: null });
  const read = await store.readFile("posts/foo.mdx");
  assert.equal(read?.content, "hello");
  assert.match(read?.sha ?? "", /^[a-f0-9]{40}$/);
  assert.equal(await store.readFile("posts/missing.mdx"), null);
});

test("db-content-store: writeBinary + readBinary round-trip preserves bytes", async () => {
  const { store } = await makeStore();
  const data = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const { sha } = await store.writeBinary("public/uploads/x.bin", data, {
    ifMatch: null,
  });
  assert.match(sha, /^[a-f0-9]{40}$/);
  const read = await store.readBinary("public/uploads/x.bin");
  assert.ok(read);
  assert.deepEqual(Array.from(read.data), Array.from(data));
});

test("db-content-store: delete enforces ifMatch and errors on missing", async () => {
  const { store } = await makeStore();
  const { sha } = await store.writeFile("posts/foo.mdx", "body", {
    ifMatch: null,
  });
  await assert.rejects(
    () => store.deleteFile("posts/foo.mdx", { ifMatch: "bogus" }),
    ContentStoreConflictError,
  );
  await store.deleteFile("posts/foo.mdx", { ifMatch: sha });
  await assert.rejects(
    () => store.deleteFile("posts/foo.mdx", { ifMatch: sha }),
    ContentStoreNotFoundError,
  );
});

test("db-content-store: rejects path traversal", async () => {
  const { store } = await makeStore();
  await assert.rejects(() => store.readFile("../secret"));
  await assert.rejects(() => store.writeFile("../secret", "x"));
});

test("db-content-store: writing identical content is a no-op (sha unchanged)", async () => {
  const { store } = await makeStore();
  const first = await store.writeFile("posts/foo.mdx", "body", {
    ifMatch: null,
  });
  const second = await store.writeFile("posts/foo.mdx", "body", {
    ifMatch: first.sha,
  });
  assert.equal(first.sha, second.sha);
});

test("db-content-store: getActor stamps updated_by on writes", async () => {
  const { client, store } = await makeStore({
    getActor: () => "test-user",
  });
  await store.writeFile("posts/foo.mdx", "body", { ifMatch: null });
  const result = await client.execute({
    sql: "SELECT updated_by FROM content_files WHERE rel_path = ?",
    args: ["posts/foo.mdx"],
  });
  assert.equal(result.rows[0]?.updated_by, "test-user");
});
