import assert from "node:assert/strict";
import test from "node:test";

import {
  assetContentDisposition,
  uploadAsset,
} from "../../lib/server/assets-store.ts";

function recordingBucket() {
  const puts = [];
  return {
    puts,
    async head() {
      return null;
    },
    async put(key, _value, options) {
      puts.push({ key, options });
      return { key, customMetadata: options?.customMetadata };
    },
    async list() {
      return { objects: [] };
    },
    async delete() {},
  };
}

test("svg uploads are stored with a download disposition", async () => {
  const bucket = recordingBucket();
  await uploadAsset({
    filename: "logo.svg",
    contentType: "image/svg+xml",
    data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    bucket,
    publicBaseUrl: "https://cdn.example.com",
  });
  assert.equal(bucket.puts.length, 1);
  assert.equal(bucket.puts[0].options.httpMetadata.contentDisposition, "attachment");
});

test("raster uploads keep inline rendering", async () => {
  const bucket = recordingBucket();
  await uploadAsset({
    contentType: "image/png",
    data: new Uint8Array([137, 80, 78, 71]),
    bucket,
    publicBaseUrl: "https://cdn.example.com",
  });
  assert.equal(bucket.puts[0].options.httpMetadata.contentDisposition, undefined);
});

test("assetContentDisposition only forces a download for svg", () => {
  assert.equal(assetContentDisposition("image/svg+xml"), "attachment");
  assert.equal(assetContentDisposition("image/png"), null);
});
