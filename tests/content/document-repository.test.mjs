import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";
import {
  DocumentConflictError,
  DocumentNotFoundError,
  toContentDocumentPath,
  toRepoContentPath,
} from "@jinnkunn/document-repository";
import { createDbDocumentRepository } from "../../lib/server/db-content-store.ts";
import { createLocalDocumentRepository } from "../../lib/server/document-repository-local.ts";

async function createDbRepository() {
  const client = createClient({ url: ":memory:" });
  for (const migration of [
    "migrations/001_content_files.sql",
    "migrations/002_content_files_history.sql",
  ]) {
    await client.executeMultiple(await readFile(path.join(process.cwd(), migration), "utf8"));
  }
  return { client, repository: createDbDocumentRepository({ executor: client }) };
}

async function exerciseRepository(repository) {
  assert.deepEqual(await repository.list("posts"), []);

  const created = await repository.writeText("posts/hello.mdx", "hello", {
    expectedVersion: null,
  });
  assert.match(created.version, /^[a-f0-9]{40}$/);
  assert.equal(created.state, "committed");

  await assert.rejects(
    repository.writeText("posts/hello.mdx", "duplicate", { expectedVersion: null }),
    DocumentConflictError,
  );
  const read = await repository.readText("posts/hello.mdx");
  assert.equal(read?.content, "hello");
  assert.equal(read?.version, created.version);

  const stat = await repository.stat("posts/hello.mdx");
  assert.equal(stat.exists, true);
  assert.equal(stat.size, 5);
  assert.equal(stat.version, created.version);

  const updated = await repository.writeText("posts/hello.mdx", "updated", {
    expectedVersion: created.version,
  });
  assert.notEqual(updated.version, created.version);
  await assert.rejects(
    repository.writeText("posts/hello.mdx", "stale", {
      expectedVersion: created.version,
    }),
    DocumentConflictError,
  );

  await repository.writeText("posts/nested/second.mdx", "second", {
    expectedVersion: null,
  });
  assert.deepEqual(
    (await repository.list("posts")).map((entry) => entry.path),
    ["posts/hello.mdx"],
  );
  assert.deepEqual(
    (await repository.list("posts", { recursive: true })).map((entry) => entry.path),
    ["posts/hello.mdx", "posts/nested/second.mdx"],
  );

  const binary = new Uint8Array([0, 1, 2, 253, 254, 255]);
  await repository.writeBinary("assets/sample.bin", binary, { expectedVersion: null });
  assert.deepEqual(
    Array.from((await repository.readBinary("assets/sample.bin")).data),
    Array.from(binary),
  );

  await repository.delete("posts/hello.mdx", { expectedVersion: updated.version });
  assert.equal(await repository.readText("posts/hello.mdx"), null);
  await assert.rejects(
    repository.delete("posts/hello.mdx", { expectedVersion: updated.version }),
    DocumentNotFoundError,
  );
}

test("document path helpers share content-root vocabulary", () => {
  assert.equal(toContentDocumentPath("content/pages/about.mdx"), "pages/about.mdx");
  assert.equal(toContentDocumentPath("pages/about.mdx"), "pages/about.mdx");
  assert.equal(toRepoContentPath("pages/about.mdx"), "content/pages/about.mdx");
  assert.throws(() => toContentDocumentPath("../outside"));
});

test("filesystem document repository satisfies the storage contract", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "document-repository-"));
  try {
    await exerciseRepository(createLocalDocumentRepository({ rootDir }));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("D1 document repository satisfies the storage contract", async () => {
  const { client, repository } = await createDbRepository();
  try {
    await exerciseRepository(repository);
  } finally {
    client.close();
  }
});

test("D1 document repository exposes text revision history", async () => {
  const { client, repository } = await createDbRepository();
  try {
    const first = await repository.writeText("pages/about.mdx", "first", {
      expectedVersion: null,
    });
    const second = await repository.writeText("pages/about.mdx", "second", {
      expectedVersion: first.version,
    });
    const history = await repository.listHistory("pages/about.mdx", 10);
    assert.deepEqual(
      history.map((revision) => revision.version),
      [second.version, first.version],
    );
    const revision = await repository.readRevision("pages/about.mdx", first.version);
    assert.equal(revision?.content, "first");
    assert.equal(revision?.version, first.version);
    const shortRevision = await repository.readRevision(
      "pages/about.mdx",
      first.version.slice(0, 7),
    );
    assert.equal(shortRevision?.content, "first");
    assert.equal(shortRevision?.version, first.version);
  } finally {
    client.close();
  }
});
