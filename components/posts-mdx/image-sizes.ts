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

/** Last path segment of an image URL, query string dropped. */
export function imageFilename(src: string): string {
  return src.split("/").pop()?.split("?")[0] ?? "";
}

export function intrinsicImageSize(filename: string): IntrinsicImageSize | null {
  return IMAGE_INTRINSIC_SIZE[filename] ?? null;
}
