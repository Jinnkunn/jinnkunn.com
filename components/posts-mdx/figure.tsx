// Image with optional caption. Mirrors the Notion image markup so existing
// lightbox + sizing CSS (in notion-blocks.css) keeps working.
export function Figure({
  src,
  alt,
  caption,
  width = "page-width",
  align = "start",
}: {
  src: string;
  alt: string;
  caption?: string;
  width?: "page-width" | "full-width" | "column-width";
  align?: "start" | "center" | "end";
}) {
  return (
    <figure className={`notion-image align-${align} ${width} mdx-figure`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- MDX figure intentionally uses plain <img> to inherit .notion-image lightbox + sizing CSS without the Next/Image wrapper. */}
      <img src={src} alt={alt} loading="lazy" decoding="async" />
      {caption && <figcaption className="notion-caption notion-semantic-string">{caption}</figcaption>}
    </figure>
  );
}
