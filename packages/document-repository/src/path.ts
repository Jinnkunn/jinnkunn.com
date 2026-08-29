const CONTENT_PREFIX = "content/";

export class DocumentPathError extends Error {
  readonly code = "INVALID_DOCUMENT_PATH";
  readonly path: string;

  constructor(input: string) {
    super(`document repository: invalid path: ${input}`);
    this.name = "DocumentPathError";
    this.path = input;
  }
}

/** Normalize a path relative to the repository's content root. */
export function normalizeDocumentPath(input: string): string {
  const raw = String(input ?? "").trim().replace(/\\/g, "/");
  const segments: string[] = [];
  for (const segment of raw.replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === ".." || segment.includes("\0")) {
      throw new DocumentPathError(input);
    }
    segments.push(segment);
  }
  if (segments.length === 0) throw new DocumentPathError(input);
  return segments.join("/");
}

/** Accept either `content/posts/a.mdx` or `posts/a.mdx`. */
export function toContentDocumentPath(input: string): string {
  const normalized = normalizeDocumentPath(input);
  return normalized.startsWith(CONTENT_PREFIX)
    ? normalizeDocumentPath(normalized.slice(CONTENT_PREFIX.length))
    : normalized;
}

/** Convert a content-root path back to its repository-root representation. */
export function toRepoContentPath(input: string): string {
  return `${CONTENT_PREFIX}${toContentDocumentPath(input)}`;
}

export function documentBasename(input: string): string {
  const normalized = normalizeDocumentPath(input);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function joinDocumentPath(...parts: string[]): string {
  return normalizeDocumentPath(parts.join("/"));
}
