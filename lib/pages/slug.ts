// Pages support hierarchical slugs (e.g. "docs/api/auth"). Each segment
// follows the same rule as a post slug — lowercase letters/digits/dashes,
// 1-60 chars, no leading/trailing dash — and segments are joined with "/".
// Maximum 4 levels deep so file paths and URLs stay sane.

const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const MAX_DEPTH = 4;

export function isValidPageSlug(slug: string): boolean {
  if (typeof slug !== "string" || !slug) return false;
  if (slug.startsWith("/") || slug.endsWith("/") || slug.includes("//")) {
    return false;
  }
  const parts = slug.split("/");
  if (parts.length > MAX_DEPTH) return false;
  return parts.every((part) => SEGMENT_RE.test(part));
}

export function assertValidPageSlug(slug: string): void {
  if (!isValidPageSlug(slug)) {
    throw new Error(
      "invalid page slug: each segment must be 1-60 chars of lowercase letters, " +
        "digits, and dashes (no leading/trailing dash); segments joined by '/'; " +
        `maximum ${MAX_DEPTH} levels deep`,
    );
  }
}

/** Parent slug for a hierarchical page slug, or null when at the root.
 * `"docs/api/auth"` → `"docs/api"`; `"about"` → `null`. */
export function pageSlugParent(slug: string): string | null {
  const idx = slug.lastIndexOf("/");
  return idx > 0 ? slug.slice(0, idx) : null;
}

/** Build a child slug from a parent slug + a leaf segment. Used by the
 * sidebar's drag-reparent flow when the user drops one page onto another
 * (target becomes the new parent). */
export function joinPageSlug(parent: string | null, leaf: string): string {
  if (!parent) return leaf;
  return `${parent}/${leaf}`;
}

/** Final segment of a slug — the "filename" that survives a re-parent. */
export function pageSlugLeaf(slug: string): string {
  const idx = slug.lastIndexOf("/");
  return idx >= 0 ? slug.slice(idx + 1) : slug;
}
