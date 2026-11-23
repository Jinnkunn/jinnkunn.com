import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cdnImageVariantUrl,
  intrinsicImageSize,
  LCP_IMAGE_FILENAME,
  POST_COLUMN_IMAGE_SIZES,
  responsiveCdnImage,
} from "../../components/posts-mdx/image-sizes.ts";

const PORTRAIT = `https://cdn.jinkunchen.com/notion-assets/${LCP_IMAGE_FILENAME}`;
const BIO = "https://cdn.jinkunchen.com/notion-assets/17140d70fdf580b0a156c957d279453c.png";

function candidates(srcSet) {
  return srcSet.split(", ").map((entry) => {
    const [url, descriptor] = entry.split(" ");
    return { url, width: Number(descriptor.replace(/w$/, "")) };
  });
}

test("CDN rasters map to same-host transforms with a Cloudflare origin fallback", () => {
  assert.equal(
    cdnImageVariantUrl(PORTRAIT, 512),
    `https://cdn.jinkunchen.com/cdn-cgi/image/width=512,quality=85,format=auto,onerror=redirect/notion-assets/${LCP_IMAGE_FILENAME}`,
  );
  assert.equal(
    cdnImageVariantUrl("https://cdn.jinkunchen.com/blog/1/axiom_comparison.png", 768),
    "https://cdn.jinkunchen.com/cdn-cgi/image/width=768,quality=85,format=auto,onerror=redirect/blog/1/axiom_comparison.png",
  );
});

test("anything that is not a plain CDN raster is left alone", () => {
  for (const src of [
    "/assets/profile.png",
    "https://jinkunchen.com/assets/profile.png",
    "https://images.example.com/a.png",
    "https://cdn.jinkunchen.com/notion-assets/diagram.svg",
    "https://cdn.jinkunchen.com/notion-assets/anim.gif",
    "https://cdn.jinkunchen.com/notion-assets/a.png?v=2",
    "https://cdn.jinkunchen.com/cdn-cgi/image/width=512/notion-assets/a.png",
    "not a url",
  ]) {
    assert.equal(cdnImageVariantUrl(src, 512), null, src);
    assert.equal(responsiveCdnImage(src, 2000), null, src);
  }
  assert.equal(responsiveCdnImage(PORTRAIT, undefined), null, "unknown intrinsic size");
  assert.equal(responsiveCdnImage(PORTRAIT, 0), null);
});

test("home portrait gets a 220px srcset and keeps its original for zoom", () => {
  const attrs = responsiveCdnImage(PORTRAIT, intrinsicImageSize(LCP_IMAGE_FILENAME).width);
  assert.equal(attrs.sizes, "220px");
  assert.equal(attrs["data-cdn-image"], "");
  assert.equal(attrs["data-lightbox-src"], PORTRAIT);
  const list = candidates(attrs.srcSet);
  assert.deepEqual(list.map((c) => c.width), [256, 384, 512, 640, 768, 1024, 1280, 1536, 1920]);
  for (const c of list) assert.equal(c.url, cdnImageVariantUrl(PORTRAIT, c.width));
  // 220 CSS px at 1x/2x/3x has a candidate within one step.
  for (const dpr of [1, 2, 3]) {
    assert.ok(list.some((c) => c.width >= 220 * dpr && c.width < 220 * dpr * 1.3), `dpr ${dpr}`);
  }
});

test("other images follow their layout box and never exceed the original", () => {
  assert.equal(
    responsiveCdnImage(BIO, 2000).sizes,
    "(max-width: 440px) 148px, (max-width: 760px) 180px, 240px",
  );
  assert.equal(
    responsiveCdnImage("https://cdn.jinkunchen.com/blog/1/axiom_comparison.png", 3559).sizes,
    POST_COLUMN_IMAGE_SIZES,
  );
  assert.equal(responsiveCdnImage("https://cdn.jinkunchen.com/blog/a.png", 3000, "100vw").sizes, "100vw");

  const small = candidates(responsiveCdnImage("https://cdn.jinkunchen.com/blog/2/x.png", 640).srcSet);
  assert.deepEqual(small.map((c) => c.width), [256, 384, 512, 640]);
  const odd = candidates(responsiveCdnImage("https://cdn.jinkunchen.com/blog/2/y.png", 1000).srcSet);
  assert.deepEqual(odd.map((c) => c.width), [256, 384, 512, 640, 768, 1000]);
});

test("post images follow phone, mid-range and desktop gutters", () => {
  assert.equal(
    POST_COLUMN_IMAGE_SIZES,
    "(max-width: 546px) calc(100vw - 48px), (max-width: 900px) calc(100vw - 96px), 708px",
  );
});

test("MDX images and figures render the responsive attributes", async () => {
  const [components, figure] = await Promise.all([
    readFile(new URL("../../components/posts-mdx/components.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/posts-mdx/figure.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(components, /props\.srcSet == null \? responsiveCdnImage\(source, intrinsic\?\.width\) : null/);
  assert.match(components, /\{\.\.\.\(responsive \?\? \{\}\)\}[\s\S]*\{\.\.\.props\}/, "authored props still win");
  assert.match(figure, /responsiveCdnImage\(src, w, width === "full-width" \? "100vw" : undefined\)/);
});
