import test from "node:test";
import assert from "node:assert/strict";

import {
  DocumentConflictError,
  DocumentOperationUnsupportedError,
} from "@jinnkunn/document-repository";
import { createSiteAdminDocumentRepository } from "@jinnkunn/site-admin-client/documents";

function ok(data, status = 200) {
  return { ok: true, status, data, raw: data };
}

function fail(code, error, status) {
  return { ok: false, status, code, error, raw: { code, error } };
}

test("remote document repository lists and reads Site Admin documents", async () => {
  const calls = [];
  const repository = createSiteAdminDocumentRepository({
    request: async (path, method, body) => {
      calls.push({ path, method, body });
      if (path === "/api/site-admin/posts?drafts=1") {
        return ok({
          posts: [
            {
              slug: "hello",
              version: "a".repeat(40),
              dateIso: "2026-08-29T12:00:00.000Z",
            },
          ],
        });
      }
      if (path === "/api/site-admin/posts/hello") {
        return ok({ source: "# Hello", version: "a".repeat(40) });
      }
      return fail("NOT_FOUND", "not found", 404);
    },
  });

  const listed = await repository.list("posts");
  assert.deepEqual(listed.map((entry) => entry.path), ["posts/hello.mdx"]);
  const document = await repository.readText("posts/hello.mdx");
  assert.equal(document?.content, "# Hello");
  assert.equal(document?.version, "a".repeat(40));
  assert.equal((await repository.stat("posts/hello.mdx")).size, 7);
  assert.equal(await repository.readText("posts/missing.mdx"), null);
  assert.equal(calls[0].method, "GET");
});

test("remote document repository maps create, queued update, delete, and conflicts", async () => {
  const calls = [];
  const repository = createSiteAdminDocumentRepository({
    request: async (path, method, body) => {
      calls.push({ path, method, body });
      if (method === "POST") return ok({ version: "b".repeat(40) }, 201);
      if (method === "PATCH") return ok({ version: "c".repeat(40) }, 202);
      if (method === "DELETE") return ok({ slug: "hello" });
      return fail("NOT_FOUND", "not found", 404);
    },
  });

  const created = await repository.writeText("posts/hello.mdx", "created", {
    expectedVersion: null,
  });
  assert.equal(created.state, "committed");
  const updated = await repository.writeText("posts/hello.mdx", "updated", {
    expectedVersion: created.version,
  });
  assert.equal(updated.state, "queued");
  await repository.delete("posts/hello.mdx", { expectedVersion: updated.version });
  assert.deepEqual(calls.map((call) => call.method), ["POST", "PATCH", "DELETE"]);
  assert.deepEqual(calls[0].body, { slug: "hello", source: "created" });

  const conflicting = createSiteAdminDocumentRepository({
    request: async () => fail("SOURCE_CONFLICT", "changed", 409),
  });
  await assert.rejects(
    conflicting.writeText("pages/about.mdx", "changed", {
      expectedVersion: "d".repeat(40),
    }),
    DocumentConflictError,
  );
  await assert.rejects(
    repository.writeText("posts/unsafe.mdx", "unsafe"),
    DocumentOperationUnsupportedError,
  );
});

test("remote document repository maps the shared versions endpoint", async () => {
  const version = "e".repeat(40);
  let empty = false;
  const repository = createSiteAdminDocumentRepository({
    request: async (path) => {
      if (path.includes("commitSha=")) {
        return ok({
          version: {
            content: empty ? "" : "old body",
            sha: version,
            commitSha: version,
          },
        });
      }
      return ok({
        history: [
          {
            commitSha: version,
            commitShort: version.slice(0, 7),
            committedAt: "2026-08-29T12:00:00.000Z",
            authorName: "i@jinkunchen.com",
            message: "update",
          },
        ],
      });
    },
  });
  const history = await repository.listHistory("pages/about.mdx", 5);
  assert.equal(history[0].version, version);
  assert.equal(history[0].actor, "i@jinkunchen.com");
  const old = await repository.readRevision("pages/about.mdx", version);
  assert.equal(old?.content, "old body");
  assert.equal(old?.version, version);
  empty = true;
  const emptyRevision = await repository.readRevision("pages/about.mdx", version);
  assert.equal(emptyRevision?.content, "");
  assert.equal(emptyRevision?.version, version);
});
