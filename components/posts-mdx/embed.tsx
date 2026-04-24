// A minimal sandboxed iframe embed. Defaults to a 16:9 aspect ratio.
// For trusted providers (YouTube, Vimeo) the caller can widen `sandbox` via prop.
export function Embed({
  src,
  title,
  aspectRatio = "16 / 9",
  sandbox = "allow-scripts allow-same-origin allow-presentation allow-popups",
  allowFullscreen = true,
  className,
}: {
  src: string;
  title: string;
  aspectRatio?: string;
  sandbox?: string;
  allowFullscreen?: boolean;
  className?: string;
}) {
  return (
    <figure className={`notion-embed mdx-embed${className ? ` ${className}` : ""}`}>
      <div className="notion-embed__container">
        <div
          className="notion-embed__container__wrapper"
          style={{ aspectRatio }}
        >
          <iframe
            className="notion-embed__content"
            src={src}
            title={title}
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
