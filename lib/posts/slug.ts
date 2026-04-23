// Slug + frontmatter validation for MDX posts. Pure, no IO.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function assertValidSlug(slug: string): void {
  if (!isValidSlug(slug)) {
    throw new Error(
      `invalid slug: must be 1-60 chars of lowercase letters, digits, and dashes (no leading/trailing dash)`,
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
  return base.length > 60 ? base.slice(0, 60).replace(/-+$/, "") : base;
}
