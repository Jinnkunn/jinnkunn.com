// A minimal sandboxed iframe embed. Defaults to a 16:9 aspect ratio.
// For trusted providers (YouTube, Vimeo) the caller can widen `sandbox` via prop.
//
// Accepts either `src` (legacy) or `url` (newer convention shared with the
// Bookmark / Video / FileLink / PageLink components emitted by the block
// editor). If both are provided, `src` wins so existing posts keep working.
export function Embed({
  src,
  url,
  title,
  aspectRatio = "16 / 9",
  sandbox = "allow-scripts allow-same-origin allow-presentation allow-popups",
  allowFullscreen = true,
  className,
}: {
  src?: string;
  url?: string;
  title?: string;
  aspectRatio?: string;
  sandbox?: string;
  allowFullscreen?: boolean;
  className?: string;
}) {
  const resolvedSrc = src ?? url ?? "";
  const resolvedTitle = title ?? "Embedded content";
  if (!resolvedSrc) return null;
  return (
    <figure className={`notion-embed mdx-embed${className ? ` ${className}` : ""}`}>
      <div className="notion-embed__container">
        <div
          className="notion-embed__container__wrapper"
          style={{ aspectRatio }}
        >
          <iframe
            className="notion-embed__content"
            src={resolvedSrc}
            title={resolvedTitle}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox={sandbox}
            allowFullScreen={allowFullscreen}
          />
        </div>
      </div>
    </figure>
  );
}
