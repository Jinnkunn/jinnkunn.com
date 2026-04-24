import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLocalContentStore } from "../lib/server/content-store.ts";
import {
  AssetsValidationError,
  uploadAsset,
  validateAssetInput,
} from "../lib/server/assets-store.ts";

async function makeRoot() {
  return mkdtemp(path.join(tmpdir(), "assets-store-"));
}

test("assets-store: rejects disallowed content types", () => {
  assert.throws(
    () =>
      validateAssetInput({
        contentType: "application/pdf",
        data: new Uint8Array([1, 2, 3]),
      }),
    AssetsValidationError,
  );
});

test("assets-store: rejects empty payloads", () => {
  assert.throws(
    () =>
      validateAssetInput({
        contentType: "image/png",
        data: new Uint8Array(0),
      }),
    AssetsValidationError,
  );
});

test("assets-store: rejects payloads over 5 MB", () => {
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  assert.throws(
    () => validateAssetInput({ contentType: "image/png", data: big }),
    AssetsValidationError,
  );
});

test("assets-store: uploads and returns deterministic URL under /uploads/yyyy/mm/", async () => {
  const root = await makeRoot();
  try {
    const store = createLocalContentStore({ rootDir: root });
    // Tiny PNG header — the store doesn't validate image bytes beyond length.
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const result = await uploadAsset({
      filename: "hello.png",
      contentType: "image/png",
      data: bytes,
      store,
    });
    assert.match(result.url, /^\/uploads\/\d{4}\/\d{2}\/[a-f0-9]{16}\.png$/);
    assert.equal(result.size, bytes.byteLength);
    assert.equal(result.contentType, "image/png");
    assert.match(result.sha, /^[a-f0-9]{40}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assets-store: second upload of the same bytes is idempotent (same URL)", async () => {
  const root = await makeRoot();
  try {
    const store = createLocalContentStore({ rootDir: root });
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const first = await uploadAsset({
      filename: "a.webp",
      contentType: "image/webp",
      data: bytes,
      store,
    });
    const again = await uploadAsset({
      filename: "b.webp", // different source filename, same bytes
      contentType: "image/webp",
      data: bytes,
      store,
    });
    assert.equal(first.url, again.url);
    assert.equal(first.key, again.key);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
