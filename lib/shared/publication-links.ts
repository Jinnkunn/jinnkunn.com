type PublicationResources = { url?: string; doiUrl?: string; arxivUrl?: string; externalUrls?: string[] };
export function publicationLinks(entry: PublicationResources): { href: string; label: string }[] {
  const seen = new Set<string>();
  const links: { href: string; label: string }[] = [];
  for (const candidate of [entry.doiUrl, entry.arxivUrl, entry.url, ...(entry.externalUrls || [])]) {
    if (!candidate) continue;
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
    const key = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const host = url.hostname.replace(/^www\./, "");
    const label = host === "doi.org" ? "DOI" : host === "arxiv.org" ? "arXiv" : ["github.com", "gitlab.com"].includes(host) ? "Code" : "Paper";
    links.push({ href: url.href, label });
  }
  return links;
}
