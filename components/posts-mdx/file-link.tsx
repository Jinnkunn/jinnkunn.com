function formatBytes(bytes?: number): string | undefined {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileLink({
  href,
  filename,
  size,
}: {
  href: string;
  filename?: string;
  size?: number;
}) {
  const display = filename ?? href;
  const sizeLabel = formatBytes(size);
  return (
    <a
      className="notion-file-link mdx-file-link"
      href={href}
      download={filename}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="notion-file-link__icon" aria-hidden="true">
        ⬇
      </span>
      <span className="notion-file-link__name">{display}</span>
      {sizeLabel ? (
        <span className="notion-file-link__size">{sizeLabel}</span>
      ) : null}
    </a>
  );
}
