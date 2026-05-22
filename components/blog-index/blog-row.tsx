import Link from "next/link";

import type { BlogPostIndexItem } from "@/lib/blog";

function formatShortDate(dateText: string | null, dateIso: string | null, sameYear: boolean): string {
  if (!dateText) return "";
  if (!dateIso) return dateText;
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateText;
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  return sameYear ? `${month} ${day}` : `${month} ${day}, ${d.getUTCFullYear()}`;
}

export function BlogRow({
  entry,
  currentYear,
}: {
  entry: BlogPostIndexItem;
  currentYear: string | null;
}) {
  const entryYear = entry.dateIso?.slice(0, 4) ?? null;
  const sameYear = Boolean(currentYear && entryYear && currentYear === entryYear);
  const shortDate = formatShortDate(entry.dateText, entry.dateIso, sameYear);

  return (
    <article className="blog-row">
      <Link className="blog-row__link" href={entry.href} aria-label={entry.title}>
        <h3 className="blog-row__title">{entry.title}</h3>
        <p className="blog-row__meta">
          {shortDate && <span className="blog-row__date">{shortDate}</span>}
        </p>
      </Link>
    </article>
  );
}
