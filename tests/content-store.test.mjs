import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  createLocalContentStore,
} from "../lib/server/content-store.ts";

async function makeRoot() {
  return mkdtemp(path.join(tmpdir(), "content-store-"));
}

test("content-store: returns empty array for missing directory", async () => {
  const root = await makeRoot();
  try {
    const store = createLocalContentStore({ rootDir: root });
    const files = await store.listFiles("posts");
    assert.deepEqual(files, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-store: lists files with sha1 + size", async () => {
  const root = await makeRoot();
  try {
    const postsDir = path.join(root, "posts");
    await writeFile(path.join(postsDir.replace(/\/+$/, ""), "a.mdx"), "hello a", {
      flag: "w",
    }).catch(async () => {
      // Ensure dir exists.
      const { mkdir } = await import("node:fs/promises");
      await mkdir(postsDir, { recursive: true });
      await writeFile(path.join(postsDir, "a.mdx"), "hello a");
    });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(postsDir, { recursive: true });
    await writeFile(path.join(postsDir, "b.mdx"), "hello b");
    const store = createLocalContentStore({ rootDir: root });
    const files = await store.listFiles("posts");
    assert.equal(files.length, 2);
    assert.deepEqual(
      files.map((f) => f.name),
      ["a.mdx", "b.mdx"],
    );
    for (const f of files) {
      assert.match(f.sha, /^[a-f0-9]{40}$/);
      assert.ok(f.size > 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-store: recursively lists nested files when requested", async () => {
  const root = await makeRoot();
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "public/uploads/2026/04"), { recursive: true });
    await writeFile(path.join(root, "public/uploads/2026/04/a.png"), "asset");
    const store = createLocalContentStore({ rootDir: root });
    assert.deepEqual(await store.listFiles("public/uploads"), []);
    const files = await store.listFiles("public/uploads", { recursive: true });
    assert.equal(files.length, 1);
    assert.equal(files[0].relPath, "public/uploads/2026/04/a.png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-store: write with ifMatch=null creates new file; second create fails", async () => {
  const root = await makeRoot();
  try {
    const store = createLocalContentStore({ rootDir: root });
    const written = await store.writeFile("posts/foo.mdx", "body", {
      ifMatch: null,
    });
    assert.match(written.sha, /^[a-f0-9]{40}$/);
    await assert.rejects(
      () => store.writeFile("posts/foo.mdx", "body2", { ifMatch: null }),
      ContentStoreConflictError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-store: update requires correct ifMatch sha", async () => {
  const root = await makeRoot();
  try {
    const store = createLocalContentStore({ rootDir: root });
    const first = await store.writeFile("posts/foo.mdx", "body v1", {
      ifMatch: null,
    });
    await assert.rejects(
      () => store.writeFile("posts/foo.mdx", "body v2", { ifMatch: "bogus" }),
      ContentStoreConflictError,
    );
    const updated = await store.writeFile("posts/foo.mdx", "body v2", {
      ifMatch: first.sha,
    });
    assert.notEqual(updated.sha, first.sha);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-store: delete requires correct ifMatch and errors on missing", async () => {
  const root = await makeRoot();
  try {
    const store = createLocalContentStore({ rootDir: root });
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-store: rejects path traversal", async () => {
  const root = await makeRoot();
  try {
    const store = createLocalContentStore({ rootDir: root });
    await assert.rejects(() => store.readFile("../secret"));
    await assert.rejects(() => store.writeFile("../secret", "x"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
