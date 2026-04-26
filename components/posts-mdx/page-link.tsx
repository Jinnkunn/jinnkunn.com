import { ClassicLink } from "@/components/classic/classic-link";

// Lightweight inline link to another /pages/<slug>. Uses the slug as
// fallback text so missing-page situations stay legible until the page is
// authored.
export function PageLink({ slug, children }: { slug: string; children?: React.ReactNode }) {
  const href = `/pages/${slug}`;
  return (
    <ClassicLink className="notion-page-link mdx-page-link" href={href}>
      <span className="notion-page-link__icon" aria-hidden="true">
        →
      </span>
      <span className="notion-page-link__label">{children ?? `/${slug}`}</span>
    </ClassicLink>
  );
}
