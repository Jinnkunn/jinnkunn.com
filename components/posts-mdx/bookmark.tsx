// Notion-style link preview card. Renders a bookmark with title, description,
// favicon-ish provider tag, and an optional thumbnail.
export function Bookmark({
  url,
  title,
  description,
  image,
  provider,
}: {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  provider?: string;
}) {
  return (
    <a
      className="notion-bookmark mdx-bookmark"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="notion-bookmark__body">
        {title ? <span className="notion-bookmark__title">{title}</span> : null}
        {description ? (
          <span className="notion-bookmark__description">{description}</span>
        ) : null}
        <span className="notion-bookmark__url">
          {provider ?? new URL(url, "https://x").hostname}
        </span>
      </div>
      {image ? (
        <div className="notion-bookmark__thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" loading="lazy" />
        </div>
      ) : null}
    </a>
  );
}
