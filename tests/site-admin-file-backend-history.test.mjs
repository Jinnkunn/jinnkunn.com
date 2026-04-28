// End-to-end coverage for the db backend's history flow:
//   write x N -> listTextFileHistory returns N entries newest-first
//   readTextFileAtCommit(rel, sha) returns the body that was at that sha
//   restore (write content from history sha) -> appears in history again
//   readTextFileAtCommit with bad sha returns null (defensive)
//   missing history table -> degrades to empty list, never throws
//
// These pin the contract the /api/site-admin/versions GET + POST routes
// rely on so a future refactor of the file backend can't silently regress.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
  createDbFileBackend,
} from "../lib/server/site-admin-file-backend.ts";

const SCHEMA_PATHS = [
  path.join(process.cwd(), "migrations/001_content_files.sql"),
  path.join(process.cwd(), "migrations/002_content_files_history.sql"),
];

async function makeBackend({ withHistoryTable = true, getActor } = {}) {
  const client = createClient({ url: ":memory:" });
  for (const p of SCHEMA_PATHS) {
    if (!withHistoryTable && p.endsWith("002_content_files_history.sql")) continue;
    const schema = await readFile(p, "utf8");
    await client.executeMultiple(schema);
  }
  const backend = createDbFileBackend({
    executor: client,
    ...(getActor ? { getActor } : {}),
  });
  return { client, backend };
}

test("file-backend history: writeTextFile appends a row per actual change", async () => {
  const { backend } = await makeBackend();
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "v1 body",
    expectedSha: "",
  });
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "v2 body",
  });
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "v3 body",
  });

  const history = await backend.listTextFileHistory("content/posts/foo.mdx", 12);
  assert.equal(history.length, 3, "one row per write");
  assert.equal(history[0].commitShort.length, 7);
  assert.match(history[0].commitSha, /^[a-f0-9]{40}$/);
});

test("file-backend history: writes that don't change content do not duplicate history", async () => {
  const { backend } = await makeBackend();
  const a = await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "same",
    expectedSha: "",
  });
  const b = await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "same",
  });
  assert.equal(a.fileSha, b.fileSha, "same content → same sha");

  const history = await backend.listTextFileHistory("content/posts/foo.mdx", 12);
  assert.equal(history.length, 1, "no-op write should not append history");
});

test("file-backend history: returns newest-first within the limit", async () => {
  const { backend } = await makeBackend();
  for (let i = 1; i <= 5; i++) {
    await backend.writeTextFile({
      repoRel: "content/posts/foo.mdx",
      content: `revision-${i}`,
    });
    // Cheap timestamp separation so updated_at differs even on fast machines.
    await new Promise((r) => setTimeout(r, 2));
  }
  const history = await backend.listTextFileHistory("content/posts/foo.mdx", 3);
  assert.equal(history.length, 3);
  // Newest-first → first entry's body should be revision-5.
  const top = await backend.readTextFileAtCommit(
    "content/posts/foo.mdx",
    history[0].commitSha,
  );
  assert.equal(top?.content, "revision-5");
});

test("file-backend history: readTextFileAtCommit returns the historical body", async () => {
  const { backend } = await makeBackend();
  const a = await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "old text",
  });
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "new text",
  });

  const versionA = await backend.readTextFileAtCommit(
    "content/posts/foo.mdx",
    a.fileSha,
  );
  assert.equal(versionA?.content, "old text");
  assert.equal(versionA?.commitSha, a.fileSha);

  // Current readTextFile reflects the *latest* write, not the historical one.
  const current = await backend.readTextFile("content/posts/foo.mdx");
  assert.equal(current?.content, "new text");
});

test("file-backend history: restore (write old body) shows up as a new history entry", async () => {
  const { backend } = await makeBackend();
  const oldVersion = await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "v1",
  });
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "v2",
  });
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "v3",
  });

  // Restore = write the historical body back. Should append a new history row.
  const at = await backend.readTextFileAtCommit(
    "content/posts/foo.mdx",
    oldVersion.fileSha,
  );
  assert.ok(at);
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: at.content,
  });

  const history = await backend.listTextFileHistory("content/posts/foo.mdx", 12);
  assert.equal(history.length, 4, "v1 + v2 + v3 + restore-back-to-v1");
  assert.equal(history[0].commitSha, oldVersion.fileSha, "newest is the restored sha");
});

test("file-backend history: bad sha shape returns null without querying", async () => {
  const { backend } = await makeBackend();
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "x",
  });
  const result = await backend.readTextFileAtCommit(
    "content/posts/foo.mdx",
    "not-a-sha",
  );
  assert.equal(result, null);
});

test("file-backend history: missing history table degrades to empty list (no throw)", async () => {
  const { backend } = await makeBackend({ withHistoryTable: false });
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "x",
    expectedSha: "",
  });
  // Even without the history table, the main upsert succeeded — so the
  // current file is readable. Only history is empty.
  const cur = await backend.readTextFile("content/posts/foo.mdx");
  assert.equal(cur?.content, "x");
  const history = await backend.listTextFileHistory("content/posts/foo.mdx", 12);
  assert.deepEqual(history, []);
});

test("file-backend history: row stamps updated_by when getActor is provided", async () => {
  const { client, backend } = await makeBackend({ getActor: () => "alice" });
  await backend.writeTextFile({
    repoRel: "content/posts/foo.mdx",
    content: "x",
    expectedSha: "",
  });
  const row = await client.execute({
    sql: "SELECT updated_by FROM content_files_history WHERE rel_path = ?",
    args: ["posts/foo.mdx"],
  });
  assert.equal(row.rows[0]?.updated_by, "alice");

  const history = await backend.listTextFileHistory("content/posts/foo.mdx", 1);
  assert.equal(history[0].authorName, "alice");
});
