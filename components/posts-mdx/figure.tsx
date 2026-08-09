// Image with optional caption. Mirrors the Notion image markup so existing
// lightbox + sizing CSS (in notion-blocks.css) keeps working.
import { imageFilename, intrinsicImageSize } from "./image-sizes";

export function Figure({
  src,
  alt,
  caption,
  width = "page-width",
  align = "start",
  intrinsicWidth,
  intrinsicHeight,
}: {
  src: string;
  alt: string;
  caption?: string;
  /** Layout variant, not a pixel size — see .notion-image in notion-blocks.css. */
  width?: "page-width" | "full-width" | "column-width";
  align?: "start" | "center" | "end";
  /** Real pixel dimensions of the source bitmap. Optional: known CDN images
   * are resolved from image-sizes.ts, this is the escape hatch for anything
   * that isn't in that table. */
  intrinsicWidth?: number;
  intrinsicHeight?: number;
}) {
  // Without these the figure reserves a zero-height box and the prose below
  // it jumps once the bitmap loads. `.mdx-figure img` keeps
  // `max-width: 100%; height: auto`, so they only supply an aspect ratio.
  const known = intrinsicImageSize(imageFilename(src));
  const w = intrinsicWidth ?? known?.width;
  const h = intrinsicHeight ?? known?.height;

  return (
    <figure className={`notion-image align-${align} ${width} mdx-figure`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- MDX figure intentionally uses plain <img> to inherit .notion-image lightbox + sizing CSS without the Next/Image wrapper. */}
      <img
        src={src}
        alt={alt}
        {...(w && h ? { width: w, height: h } : {})}
        loading="lazy"
        decoding="async"
      />
      {caption && <figcaption className="notion-caption notion-semantic-string">{caption}</figcaption>}
    </figure>
  );
}
