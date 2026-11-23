// Intrinsic pixel dimensions for the images this site actually ships.
//
// A bare `<img>` with no width/height reserves a zero-height box until the
// bitmap arrives, so everything below it jumps down once it does. That is
// worst on the home page: the portrait is the LCP element, and at mobile
// widths the intro grid stacks image-first, so the whole bio block shifts by
// a portrait's height mid-load.
//
// The attributes these numbers feed only establish an aspect ratio —
// posts-mdx.css pins `max-width: 100%; height: auto` on every MDX image, so
// the *used* width stays entirely CSS/grid-derived. Never translate a value
// here into a CSS width: the home portrait's 220px desktop width falls out of
// the intro grid's track sizing and is asserted as such by the style gates.
//
// Values read from each PNG's IHDR header on cdn.jinkunchen.com. Images that
// are not listed simply render without the attributes, exactly as before.
export type IntrinsicImageSize = { width: number; height: number };

const IMAGE_INTRINSIC_SIZE: Record<string, IntrinsicImageSize> = {
  // Home portrait and the /bio photo.
  "17140d70fdf5805f8936f05797866cba.png": { width: 2433, height: 3165 },
  "17140d70fdf580b0a156c957d279453c.png": { width: 2000, height: 2001 },
  // blog/1 — approximate abelian group.
  "axiom_comparison.png": { width: 3559, height: 1771 },
  "performance_radar.png": { width: 2339, height: 2364 },
  "error_distributions.png": { width: 4469, height: 2365 },
  // blog/2 — memory order.
  "semantic_similarity_heatmap.png": { width: 1000, height: 500 },
  "pca_style_clusters.png": { width: 800, height: 600 },
  "Structure_Score_vs_Similarity_to_A.png": { width: 640, height: 480 },
  // blog/5 — reasoning drift.
  "uncertainty.png": { width: 1580, height: 892 },
  // blog/7 — context order.
  "order_sensitivity_schematic_v2.png": { width: 1400, height: 820 },
  "order_sensitivity_pipeline_v2.png": { width: 1400, height: 820 },
  "order_sensitivity_protocol.png": { width: 1400, height: 820 },
};

/** The home portrait — the site's LCP element. It is fetched at high
 * priority and must never be lazy-loaded. */
export const LCP_IMAGE_FILENAME = "17140d70fdf5805f8936f05797866cba.png";

// ---------------------------------------------------------------------------
// Responsive variants.
//
// The originals on cdn.jinkunchen.com are full-resolution PNGs: the home
// portrait is 2433x3165 / 1.75 MB for a 220px box. Cloudflare Image
// Transformations are enabled on the zone, so a resized AVIF/WebP of any CDN
// image is just a `/cdn-cgi/image/<options>/<path>` URL away (the 512px AVIF of
// the portrait is ~20 KB). `format=auto` negotiates AVIF/WebP/PNG from the
// request's Accept header, and the result is cached at the edge.
//
// Only `srcset`/`sizes` change: `src` stays the original (it is what crawlers
// and the lightbox see), and the intrinsic width/height attributes keep
// driving layout, so no box moves.

const MEDIA_ORIGIN = "https://cdn.jinkunchen.com";
const TRANSFORMABLE_PATH = /\.(?:png|jpe?g|webp)$/i;
const VARIANT_WIDTHS = [256, 384, 512, 640, 768, 1024, 1280, 1536, 1920];
const VARIANT_QUALITY = 85;

/** Match the phone and mid-range gutters in notion.css and page-overrides.css.
 * Above 900px, the 900px cap minus the two 96px gutters leaves 708px. */
export const POST_COLUMN_IMAGE_SIZES =
  "(max-width: 546px) calc(100vw - 48px), (max-width: 900px) calc(100vw - 96px), 708px";

/** Images laid out in a smaller box than the post column. `sizes` has to match
 * the real box: smaller and the browser picks a blurry variant, larger and it
 * over-fetches. */
const IMAGE_DISPLAY_SIZES: Record<string, string> = {
  // home.css: `.home-layout--variant-classicIntro` portrait, max-width 220px.
  "17140d70fdf5805f8936f05797866cba.png": "220px",
  // bio.css: `.bio-intro__portrait` is 240px, 180px at <=760px, 148px at <=440px.
  "17140d70fdf580b0a156c957d279453c.png": "(max-width: 440px) 148px, (max-width: 760px) 180px, 240px",
};

/** URL of a `width`-pixel-wide, format-negotiated variant of a CDN image, or
 * null when `src` is not a plain raster on the media CDN. */
export function cdnImageVariantUrl(src: string, width: number): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.origin !== MEDIA_ORIGIN || url.search || url.hash) return null;
  if (url.pathname.startsWith("/cdn-cgi/") || !TRANSFORMABLE_PATH.test(url.pathname)) return null;
  const w = Math.floor(width);
  if (!(w > 0)) return null;
  return `${MEDIA_ORIGIN}/cdn-cgi/image/width=${w},quality=${VARIANT_QUALITY},format=auto,onerror=redirect${url.pathname}`;
}

export type ResponsiveImageAttributes = {
  srcSet: string;
  sizes: string;
  "data-cdn-image": "";
  "data-lightbox-src": string;
};

/** `srcSet`/`sizes` for a CDN image of known intrinsic width, or null for
 * anything else (which then renders exactly as before). Variants never exceed
 * the original's width. */
export function responsiveCdnImage(
  src: string,
  intrinsicWidth: number | null | undefined,
  sizes?: string,
): ResponsiveImageAttributes | null {
  if (!intrinsicWidth || intrinsicWidth <= 0) return null;
  if (!cdnImageVariantUrl(src, intrinsicWidth)) return null;
  const largest = Math.min(intrinsicWidth, VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]);
  const widths = [...new Set([...VARIANT_WIDTHS.filter((w) => w < largest), largest])];
  return {
    srcSet: widths.map((w) => `${cdnImageVariantUrl(src, w)} ${w}w`).join(", "),
    sizes: sizes ?? IMAGE_DISPLAY_SIZES[imageFilename(src)] ?? POST_COLUMN_IMAGE_SIZES,
    "data-cdn-image": "",
    // The lightbox reads `currentSrc` otherwise, which is now the column-sized
    // variant; zooming keeps showing the full-resolution original.
    "data-lightbox-src": src,
  };
}

/** Last path segment of an image URL, query string dropped. */
export function imageFilename(src: string): string {
  return src.split("/").pop()?.split("?")[0] ?? "";
}

export function intrinsicImageSize(filename: string): IntrinsicImageSize | null {
  return IMAGE_INTRINSIC_SIZE[filename] ?? null;
}
