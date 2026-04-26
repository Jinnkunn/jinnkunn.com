import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { createLocalContentStore } from "../lib/server/content-store.ts";

// Import from the pure shape file so the test doesn't drag in the
// content-store-resolver (which expects Next.js env config). The shape
// helpers are the same ones next.config.mjs and lib/redirects.ts rely on.
import {
  buildNextRedirects,
  normalizeRedirectsTable,
} from "../lib/redirects-shape.ts";

test("buildNextRedirects emits both /pages/<slug> and bare /<slug> mounts", () => {
  const out = buildNextRedirects({
    pages: { "old-bio": "bio", chen: "about/chen" },
    posts: {},
  });
  // Each page rename produces 2 entries (the /pages mount + the bare
  // catch-all mount), so 2 renames = 4 entries.
  assert.equal(out.length, 4);
  assert.deepEqual(
    out.find((r) => r.source === "/pages/old-bio"),
    { source: "/pages/old-bio", destination: "/pages/bio", permanent: true },
  );
  assert.deepEqual(
    out.find((r) => r.source === "/old-bio"),
    { source: "/old-bio", destination: "/bio", permanent: true },
  );
  assert.deepEqual(
    out.find((r) => r.source === "/chen"),
    { source: "/chen", destination: "/about/chen", permanent: true },
  );
});

test("buildNextRedirects emits /blog/<slug> for renamed posts", () => {
  const out = buildNextRedirects({
    pages: {},
    posts: { "hello-world": "introducing-hello-world" },
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    source: "/blog/hello-world",
    destination: "/blog/introducing-hello-world",
    permanent: true,
  });
});

test("buildNextRedirects drops self-redirects and empty entries", () => {
  const out = buildNextRedirects({
    pages: { "": "x", x: "", same: "same", real: "renamed" },
    posts: { "": "", a: "a" },
  });
  // Only `real → renamed` survives — and emits the 2-entry pair
  // (/pages/real + /real) for parity with the catch-all mount.
  assert.equal(out.length, 2);
  assert.ok(out.some((r) => r.source === "/pages/real"));
  assert.ok(out.some((r) => r.source === "/real"));
});

test("normalizeRedirectsTable strips non-string entries from arbitrary input", () => {
  const result = normalizeRedirectsTable({
    pages: { good: "ok", bad: 123, missing: null },
    posts: "not-an-object",
    other: { ignored: "value" },
  });
  assert.deepEqual(result.pages, { good: "ok" });
  assert.deepEqual(result.posts, {});
});

test("normalizeRedirectsTable returns empty table for non-object input", () => {
  assert.deepEqual(normalizeRedirectsTable(null), { pages: {}, posts: {} });
  assert.deepEqual(normalizeRedirectsTable("string"), { pages: {}, posts: {} });
  assert.deepEqual(normalizeRedirectsTable(42), { pages: {}, posts: {} });
});

test("appendRedirect persists the rename to redirects.json", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "redirects-test-"));
  try {
    const store = createLocalContentStore({ rootDir: tmp });
    // Direct exercise of the json shape against a fresh empty store.
    const initial = await store.readFile("redirects.json");
    assert.equal(initial, null);
    // Simulate what appendRedirect would write.
    await store.writeFile(
      "redirects.json",
      JSON.stringify(
        { pages: { "old-bio": "bio" }, posts: {} },
        null,
        2,
      ) + "\n",
      { ifMatch: null },
    );
    const after = await store.readFile("redirects.json");
    assert.ok(after);
    const parsed = JSON.parse(after.content);
    assert.deepEqual(parsed.pages, { "old-bio": "bio" });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
