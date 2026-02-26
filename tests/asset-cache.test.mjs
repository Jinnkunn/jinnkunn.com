import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAssetDownloader } from "../scripts/notion-sync/asset-cache.mjs";

test("asset-cache: dedupes notion signed urls by host+path key", async (t) => {
  const unique = `asset-cache-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const outPublicAssetsDir = path.join(process.cwd(), "public", "notion-assets");
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), `${unique}-`));
  const createdPublicPaths = [];
  t.after(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    for (const p of createdPublicPaths) fs.rmSync(p, { force: true });
  });

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const downloadAsset = createAssetDownloader({
    outPublicAssetsDir,
    cacheDir,
    force: false,
  });

  const first = await downloadAsset(
    "https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/file.png?X-Amz-Signature=aaa",
    `${unique}-a`,
  );
  const second = await downloadAsset(
    "https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/file.png?X-Amz-Signature=bbb",
    `${unique}-b`,
  );

  const firstAbs = path.join(process.cwd(), "public", first.replace(/^\/+/, ""));
  const secondAbs = path.join(process.cwd(), "public", second.replace(/^\/+/, ""));
  createdPublicPaths.push(firstAbs, secondAbs);

  assert.equal(fetchCount, 1);
  assert.equal(first, second);
  assert.equal(fs.existsSync(firstAbs), true);
});
