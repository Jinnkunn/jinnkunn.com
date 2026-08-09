// Local (fs) mode used to hash text files as sha1(JSON.stringify(content))
// while ContentStore — the store the posts/pages editors read their version
// token from — hashed the raw bytes. The two could never be equal, so every
// version restore in local/dev mode failed its optimistic-lock check with a
// 409. These pin the two hashes together.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLocalContentStore } from "../../lib/server/content-store.ts";
import {
  createFsFileBackend,
  isSiteAdminFileBackendConflictError,
} from "../../lib/server/site-admin-file-backend.ts";

async function makeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "site-admin-fs-backend-"));
  await mkdir(path.join(root, "content", "posts"), { recursive: true });
  return root;
}

test("fs backend: readTextFile sha matches ContentStore's version token", async () => {
  const root = await makeRoot();
  const backend = createFsFileBackend({ rootDir: root });
  const store = createLocalContentStore({ rootDir: path.join(root, "content") });

  const body = "---\ntitle: Hello\n---\n\nbody text\n";
  const written = await store.writeFile("posts/hello.mdx", body);

  const read = await backend.readTextFile("content/posts/hello.mdx");
  assert.equal(read?.content, body);
  assert.equal(read?.sha, written.sha);
  assert.equal(read?.sha, createHash("sha1").update(body, "utf8").digest("hex"));
});

test("fs backend: restore with the editor's version token succeeds (no 409)", async () => {
  const root = await makeRoot();
  const backend = createFsFileBackend({ rootDir: root });
  const store = createLocalContentStore({ rootDir: path.join(root, "content") });

  // What the console holds: the version the posts endpoint handed back.
  const current = await store.writeFile("posts/hello.mdx", "current body\n");

  // What /api/site-admin/versions POST does with it.
  const restored = await backend.writeTextFile({
    repoRel: "content/posts/hello.mdx",
    content: "older body\n",
    expectedSha: current.sha,
  });
  assert.equal(
    restored.fileSha,
    createHash("sha1").update("older body\n", "utf8").digest("hex"),
  );

  const after = await store.readFile("posts/hello.mdx");
  assert.equal(after?.content, "older body\n");
  assert.equal(after?.sha, restored.fileSha, "the post endpoint sees the restored sha");
});

test("fs backend: a stale version token still conflicts", async () => {
  const root = await makeRoot();
  const backend = createFsFileBackend({ rootDir: root });
  await writeFile(path.join(root, "content", "posts", "hello.mdx"), "v2\n", "utf8");

  await assert.rejects(
    backend.writeTextFile({
      repoRel: "content/posts/hello.mdx",
      content: "restored\n",
      expectedSha: createHash("sha1").update("v1\n", "utf8").digest("hex"),
    }),
    (err) => isSiteAdminFileBackendConflictError(err),
  );
});

test("fs backend: empty expectedSha means 'file should not exist yet'", async () => {
  const root = await makeRoot();
  const backend = createFsFileBackend({ rootDir: root });

  const created = await backend.writeTextFile({
    repoRel: "content/posts/fresh.mdx",
    content: "new\n",
    expectedSha: "",
  });
  assert.match(created.fileSha, /^[a-f0-9]{40}$/);

  await assert.rejects(
    backend.writeTextFile({
      repoRel: "content/posts/fresh.mdx",
      content: "again\n",
      expectedSha: "",
    }),
    (err) => isSiteAdminFileBackendConflictError(err),
  );
});
