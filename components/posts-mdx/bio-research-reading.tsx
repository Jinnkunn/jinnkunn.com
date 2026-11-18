import "server-only";

import { ClassicLink } from "@/components/classic/classic-link";
import { publicationsDisplayedOnPage } from "@/lib/components/parse";
import { readComponentSource } from "@/lib/components/source";
import { readPage } from "@/lib/pages/store";
import { getProtectedRoutes } from "@/lib/protected-routes";
import { findProtectedMatch } from "@/lib/routes/strategy";
import { publicationAnchorId } from "@/lib/shared/publication-identity";
import { publicationLinks } from "@/lib/shared/publication-links";

const TOPICS = [
  { label: "Explainable and responsible AI", resource: "arxiv.org/abs/2506.07517" },
  { label: "Memory and evolving agents", resource: "arxiv.org/abs/2510.13982" },
  { label: "AI for Science and visualization", resource: "doi.org/10.1016/j.softx.2024.101952" },
];

export async function BioResearchReading() {
  if (findProtectedMatch("/publications", getProtectedRoutes())) return null;
  const [page, component] = await Promise.all([readPage("publications"), readComponentSource("publications")]);
  if (!page || page.entry.draft) return null;
  const entries = publicationsDisplayedOnPage(page.source, component);
  const rows = TOPICS.flatMap(({ label, resource }) => {
    const entry = entries.find((entry) => publicationLinks(entry).some(({ href }) => {
      const url = new URL(href);
      return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}` === resource;
    }));
    return entry ? [{ label, title: entry.title, href: `/publications#${publicationAnchorId(entry.entryId)}` }] : [];
  });
  if (!rows.length) return null;

  return (
    <section className="reading-guide bio-research-reading" aria-labelledby="bio-research-reading">
      <h2 id="bio-research-reading">Selected research reading</h2>
      <dl>
        {rows.map(({ label, title, href }) => (
          <div key={href}>
            <dt>{label}</dt>
            <dd><ClassicLink href={href}>{title}</ClassicLink></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
