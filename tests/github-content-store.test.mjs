import test from "node:test";
import assert from "node:assert/strict";

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
} from "../lib/server/content-store.ts";
import { createGithubContentStore } from "../lib/server/github-content-store.ts";

// In-memory mock of the GitHub Contents API — small enough to be obvious, rich
// enough to exercise 404 / 409 / 422 paths.
function makeMockClient(initialFiles = new Map()) {
  // Map<string repoPath, { sha, content }>
  const files = new Map(initialFiles);
  let sequence = 0;
  const calls = [];

  function makeSha(seed) {
    sequence += 1;
    return `sha-${sequence}-${seed.slice(0, 8)}`;
  }

  return {
    files,
    calls,
    client: {
      async request({ method, apiPath, body }) {
        calls.push({ method, apiPath, body });
        // Match: GET /repos/<owner>/<repo>/contents/<encodedPath>?ref=<branch>
        const match = apiPath.match(
          /^\/repos\/([^/]+)\/([^/]+)\/contents\/([^?]+)(?:\?ref=([^&]+))?$/,
        );
        if (!match) {
          throw Object.assign(new Error(`Unexpected apiPath: ${apiPath}`), {
            status: 404,
            name: "GitHubApiError",
          });
        }
        const [, , , rawPath] = match;
        const pathStr = decodeURIComponent(rawPath.split("/").map(decodeURIComponent).join("/"));

        if (method === "GET") {
          if (files.has(pathStr)) {
            const f = files.get(pathStr);
            return {
              type: "file",
              name: pathStr.split("/").pop(),
              path: pathStr,
              sha: f.sha,
              size: Buffer.byteLength(f.content, "utf8"),
              encoding: "base64",
              content: Buffer.from(f.content, "utf8").toString("base64"),
            };
          }
          // Directory listing: files whose key starts with "<pathStr>/" and has no further "/"
          const dirPrefix = `${pathStr}/`;
          const dirChildren = Array.from(files.entries())
            .filter(
              ([k]) => k.startsWith(dirPrefix) && !k.slice(dirPrefix.length).includes("/"),
            )
            .map(([k, v]) => ({
              type: "file",
              name: k.split("/").pop(),
              path: k,
              sha: v.sha,
              size: Buffer.byteLength(v.content, "utf8"),
            }));
          if (dirChildren.length > 0) return dirChildren;
          const err = new Error("Not Found");
          err.name = "GitHubApiError";
          err.status = 404;
          err.responseBody = { message: "Not Found" };
          throw err;
        }

        if (method === "PUT") {
          const expected = body?.sha;
          const current = files.get(pathStr);
          if (expected && current && current.sha !== expected) {
            const err = new Error("sha mismatch");
            err.name = "GitHubApiError";
            err.status = 409;
            err.responseBody = { message: "sha mismatch" };
            throw err;
          }
          if (!expected && current) {
            // Trying to create but file exists.
            const err = new Error("file exists");
            err.name = "GitHubApiError";
            err.status = 422;
            err.responseBody = { message: "file exists" };
            throw err;
          }
          const content = Buffer.from(body.content, "base64").toString("utf8");
          const sha = makeSha(content);
          files.set(pathStr, { sha, content });
          return {
            content: { sha, path: pathStr },
            commit: { sha: `commit-${sequence}` },
          };
        }

        if (method === "DELETE") {
          const expected = body?.sha;
          const current = files.get(pathStr);
          if (!current) {
            const err = new Error("Not Found");
            err.name = "GitHubApiError";
            err.status = 404;
            err.responseBody = { message: "Not Found" };
            throw err;
          }
          if (expected && current.sha !== expected) {
            const err = new Error("sha mismatch");
            err.name = "GitHubApiError";
            err.status = 409;
            err.responseBody = { message: "sha mismatch" };
            throw err;
          }
          files.delete(pathStr);
          return { commit: { sha: `commit-${sequence}` } };
        }

        const err = new Error(`Unexpected method ${method}`);
        err.name = "GitHubApiError";
        err.status = 500;
        throw err;
      },
    },
  };
}

// Ensure the mock's GitHubApiError-named errors pass instanceof checks.
// We use a name-based shim since the store imports GitHubApiError from the
// real module; our mock throws objects with the same shape (status +
// responseBody). The store only uses `instanceof GitHubApiError` for the 409/422/404
// fallback paths; our mock throws `Error` with that name. To make the store's
// instanceof checks succeed, import the real class and monkey-patch.
import { GitHubApiError } from "../lib/server/github-content-client.ts";
function wrapClientWithRealErrors(raw) {
  return {
    async request(input) {
      try {
        return await raw.request(input);
      } catch (err) {
        if (err && err.name === "GitHubApiError") {
          throw new GitHubApiError({
            status: err.status,
            message: err.message,
            responseBody: err.responseBody,
          });
        }
        throw err;
      }
    },
  };
}

function makeStore(initialFiles) {
  const mock = makeMockClient(initialFiles);
  const store = createGithubContentStore({
    client: wrapClientWithRealErrors(mock.client),
    owner: "example",
    repo: "repo",
    branch: "main",
    rootDirInRepo: "content",
  });
  return { store, mock };
}

test("github-content-store: read returns null for missing path", async () => {
  const { store } = makeStore();
  const result = await store.readFile("posts/nope.mdx");
  assert.equal(result, null);
});

test("github-content-store: write with ifMatch=null creates new file; second create conflicts", async () => {
  const { store } = makeStore();
  const first = await store.writeFile("posts/hello.mdx", "body", { ifMatch: null });
  assert.match(first.sha, /^sha-/);

  await assert.rejects(
    () => store.writeFile("posts/hello.mdx", "body2", { ifMatch: null }),
    ContentStoreConflictError,
  );
});

test("github-content-store: update requires correct ifMatch sha", async () => {
  const { store } = makeStore();
  const first = await store.writeFile("posts/hello.mdx", "body v1", { ifMatch: null });

  await assert.rejects(
    () => store.writeFile("posts/hello.mdx", "body v2", { ifMatch: "bogus" }),
    ContentStoreConflictError,
  );

  const updated = await store.writeFile("posts/hello.mdx", "body v2", {
    ifMatch: first.sha,
  });
  assert.notEqual(updated.sha, first.sha);
  const read = await store.readFile("posts/hello.mdx");
  assert.equal(read.content, "body v2");
});

test("github-content-store: unchanged text write returns existing sha without PUT", async () => {
  const { store, mock } = makeStore(
    new Map([["content/posts/hello.mdx", { sha: "sha-existing", content: "same body" }]]),
  );

  const result = await store.writeFile("posts/hello.mdx", "same body", {
    ifMatch: "sha-existing",
  });

  assert.equal(result.sha, "sha-existing");
  assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 0);
});

test("github-content-store: delete requires correct ifMatch and errors when missing", async () => {
  const { store } = makeStore();
  const { sha } = await store.writeFile("posts/hello.mdx", "body", { ifMatch: null });

  await assert.rejects(
    () => store.deleteFile("posts/hello.mdx", { ifMatch: "bogus" }),
    ContentStoreConflictError,
  );
  await store.deleteFile("posts/hello.mdx", { ifMatch: sha });
  await assert.rejects(
    () => store.deleteFile("posts/hello.mdx", { ifMatch: sha }),
    ContentStoreNotFoundError,
  );
});

test("github-content-store: listFiles returns empty array for missing dir", async () => {
  const { store } = makeStore();
  const files = await store.listFiles("posts");
  assert.deepEqual(files, []);
});

test("github-content-store: listFiles returns children with sha", async () => {
  const { store } = makeStore();
  await store.writeFile("posts/a.mdx", "aaa", { ifMatch: null });
  await store.writeFile("posts/b.mdx", "bbb", { ifMatch: null });
  const files = await store.listFiles("posts");
  assert.deepEqual(
    files.map((f) => f.name),
    ["a.mdx", "b.mdx"],
  );
  for (const f of files) {
    assert.match(f.sha, /^sha-/);
    assert.ok(f.size > 0);
  }
});

test("github-content-store: rejects path traversal", async () => {
  const { store } = makeStore();
  await assert.rejects(() => store.readFile("../secret"));
  await assert.rejects(() => store.writeFile("../secret", "x"));
});
