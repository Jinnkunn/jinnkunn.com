// Slug + frontmatter validation for MDX posts. Pure, no IO.

export const POST_SLUG_MAX_LENGTH = 120;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function assertValidSlug(slug: string): void {
  if (!isValidSlug(slug)) {
    throw new Error(
      `invalid slug: must be 1-${POST_SLUG_MAX_LENGTH} chars of lowercase letters, digits, and dashes (no leading/trailing dash)`,
    );
  }
}

export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return "post";
  return base.length > POST_SLUG_MAX_LENGTH
    ? base.slice(0, POST_SLUG_MAX_LENGTH).replace(/-+$/, "")
    : base;
}
