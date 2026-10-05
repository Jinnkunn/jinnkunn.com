import { publicationLinks } from "@/lib/shared/publication-links";

export function PublicationResourceLinks({ entry }: { entry: Parameters<typeof publicationLinks>[0] }) {
  const links = publicationLinks(entry);
  if (!links.length) return null;
  return <span className="pub-resource-links" role="group" aria-label="Publication resources">
    {links.map(({ href, label }) => <a key={href} className="notion-link link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>{label}</a>)}
  </span>;
}
