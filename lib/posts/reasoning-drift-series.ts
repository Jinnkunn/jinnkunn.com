const READING_ORDER = [
  { slug: "when-ai-reasoning-starts-to-drift", label: "Recognizing reasoning drift" },
  { slug: "measuring-reasoning-drift-a-token-level-instability-signal", label: "Measuring drift at the token level" },
  { slug: "context-order-and-reasoning-drift-measuring-order-sensitivity-from-token-probabilities", label: "Testing context order" },
];

export type SeriesLink = { href: string; label: string };

export function reasoningDriftReadingOrder(posts: ReadonlyArray<{ slug: string; href: string }>): SeriesLink[] {
  const paths = new Map(posts.map((post) => [post.slug, post.href]));
  const links = READING_ORDER.flatMap(({ slug, label }) => {
    const href = paths.get(slug);
    return href ? [{ href, label }] : [];
  });
  return links.length > 1 ? links : [];
}
