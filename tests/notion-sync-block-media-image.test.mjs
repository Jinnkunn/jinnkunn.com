import test from "node:test";
import assert from "node:assert/strict";

import { renderImageBlock } from "../scripts/notion-sync/renderers/block-media.mjs";

test("block-media image: notion-assets use responsive srcset via _next/image", async () => {
  const html = await renderImageBlock({
    b: {
      image: {
        type: "file",
        file: { url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b.png" },
        caption: [{ plain_text: "Example" }],
      },
    },
    blockIdAttr: "block-abc",
    id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ctx: {
      downloadAsset: async () => "/notion-assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    },
  });

  assert.match(
    html,
    /src="\/_next\/image\?url=%2Fnotion-assets%2Faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\.png&amp;w=1280&amp;q=82"/,
  );
  assert.match(html, /srcset="[^"]*w=480&amp;q=82 480w[^"]*w=1920&amp;q=82 1920w"/);
  assert.match(html, /sizes="\(max-width: 960px\) 100vw, 960px"/);
  assert.match(html, /data-lightbox-src="\/notion-assets\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\.png"/);
});

test("block-media image: external image keeps original src without srcset", async () => {
  const html = await renderImageBlock({
    b: {
      image: {
        type: "external",
        external: { url: "https://cdn.example.com/sample.png" },
        caption: [],
      },
    },
    blockIdAttr: "block-def",
    id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ctx: {},
  });

  assert.match(html, /src="https:\/\/cdn\.example\.com\/sample\.png"/);
  assert.doesNotMatch(html, /srcset=/);
  assert.doesNotMatch(html, /sizes=/);
});
