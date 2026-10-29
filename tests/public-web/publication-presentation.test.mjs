import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { additionalPublicationVenues, venueSummaryText } from "../../components/publications/labels.ts";
import { publicationLinks } from "../../lib/shared/publication-links.ts";
import { parsePublicationsEntries } from "../../lib/components/parse.ts";

test("publication presentation: removes resource-only additional venues without changing source records", () => {
  const venues = [
    { type: "journal", text: "SoftwareX, vol 28, 101952. Elsevier. dio: 10.1016/j.softx.2024.101952" },
    { type: "arXiv.org", text: "Available at: https://arxiv.org/abs/2407.08082", url: "https://arxiv.org/abs/2407.08082" },
    { type: "journal", text: "DOI: 10.1000/example" },
    { type: "source", text: "https://example.com/paper" },
    { type: "source", text: "", url: "https://example.com/supplement" },
  ];
  const before = structuredClone(venues);
  assert.deepEqual(additionalPublicationVenues(venues), []);
  assert.deepEqual(venues, before);
});

test("publication presentation: preserves meaningful additional venue descriptions, without embedded URLs", () => {
  const venues = [
    { type: "conference", text: "27th International Conference on Pattern Recognition (ICPR)" },
    { type: "journal", text: "Pattern Recognition. Lecture Notes in Computer Science, vol 15303. Springer, Cham. dio: https://doi.org/10.1007/example", url: "https://doi.org/10.1007/example" },
    { type: "arXiv.org", text: "Available at: https://arxiv.org/abs/2409.00356" },
    { type: "workshop", text: "Extended workshop version" },
  ];
  assert.deepEqual(additionalPublicationVenues(venues), [
    { type: "journal", text: "Pattern Recognition. Lecture Notes in Computer Science, vol 15303. Springer, Cham" },
    { type: "workshop", text: "Extended workshop version" },
  ]);
});

test("publication presentation: empty or single-venue entries have no extra details", () => {
  assert.deepEqual(additionalPublicationVenues([]), []);
  assert.deepEqual(additionalPublicationVenues([{ type: "conference", text: "AAAI-26" }]), []);
});

test("publication presentation: summary never falls back to displaying a raw resource URL", () => {
  assert.equal(venueSummaryText({ type: "journal", text: "https://doi.org/10.1000/example" }), "");
  assert.equal(venueSummaryText({ type: "arXiv.org", text: "Available at: https://arxiv.org/abs/2407.08082" }), "arXiv preprint");
  assert.equal(venueSummaryText({ type: "journal", text: "SoftwareX. doi: 10.1000/example" }), "SoftwareX");
});

test("publication resources: promotes venue-only links and deduplicates them against the resource fields", () => {
  const arxivUrl = "https://arxiv.org/abs/2407.08082";
  const doiUrl = "https://doi.org/10.1016/j.softx.2024.101952";
  assert.deepEqual(publicationLinks({
    url: doiUrl,
    doiUrl,
    arxivUrl,
    externalUrls: [doiUrl, arxivUrl],
    venues: [
      { type: "journal", text: `SoftwareX. doi: ${doiUrl}`, url: doiUrl },
      { type: "arXiv.org", text: `Available at: ${arxivUrl}`, url: `https://www.arxiv.org/abs/2407.08082/` },
      { text: "Available at: https://example.com/supplement." },
      { url: "https://github.com/example/repo" },
      { url: "javascript:alert(1)" },
      { url: "https://user:password@example.com/private" },
    ],
  }), [
    { href: doiUrl, label: "DOI" },
    { href: arxivUrl, label: "arXiv" },
    { href: "https://example.com/supplement", label: "Paper" },
    { href: "https://github.com/example/repo", label: "Code" },
  ]);
});

test("publication resources: accepts optional venue fields and entries without links", () => {
  assert.deepEqual(publicationLinks({}), []);
  assert.deepEqual(publicationLinks({ venues: [{}, { text: "Test Conference 2026" }] }), []);
});

test("publication presentation: CAB-KWS retains its journal description for the summary, with no repeated URLs", async () => {
  const source = await readFile(new URL("../../content/components/publications.mdx", import.meta.url), "utf8");
  const entries = parsePublicationsEntries(source);
  const maritime = entries.find((entry) => entry.title.includes("AISDB"));
  const cab = entries.find((entry) => entry.title.startsWith("CAB-KWS"));
  assert.ok(maritime);
  assert.ok(cab);
  assert.deepEqual(additionalPublicationVenues(maritime.venues), []);
  assert.equal(publicationLinks(maritime).filter((link) => link.label === "arXiv").length, 1);
  const details = additionalPublicationVenues(cab.venues);
  assert.equal(details.length, 1);
  assert.equal(details[0].type, "journal");
  assert.match(details[0].text, /Lecture Notes in Computer Science/);
  assert.doesNotMatch(details[0].text, /https?:|\b(?:doi|dio):|Available at/i);
});

test("publication presentation: both rendering paths keep venue metadata in the summary and authors alone in expanded content", async () => {
  for (const path of ["../../components/publications/publication-list.tsx", "../../components/posts-mdx/publications-entry.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const [summary, expanded] = source.split('<div className="notion-toggle__content"');
    assert.ok(expanded, path);
    assert.match(summary, /additionalVenues\.map/);
    assert.match(summary, /pub-venue-line highlighted-color color-gray/);
    assert.ok(summary.indexOf("additionalVenues.map") < summary.indexOf("<PublicationResourceLinks"));
    assert.match(expanded, /authors\.length > 0/);
    assert.match(expanded, /<AuthorsLine|authors\.map/);
    assert.doesNotMatch(expanded, /additionalVenues|VenueLine|PublicationTag|PublicationResourceLinks|pub-tag-colon|<br/);
  }
});

test("publication presentation: both rendering paths put the primary venue on its own row after labels and highlights", async () => {
  for (const path of ["../../components/publications/publication-list.tsx", "../../components/posts-mdx/publications-entry.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /const hasMetadata = labels\.length > 0 \|\| highlights\.length > 0;/);
    const metadataStart = source.indexOf("{hasMetadata &&");
    const venueStart = source.indexOf("{primaryVenue ?", metadataStart);
    assert.ok(metadataStart >= 0 && venueStart > metadataStart, path);
    const metadata = source.slice(metadataStart, venueStart);
    assert.match(metadata, /pub-meta-line ds-meta-row/);
    assert.match(metadata, /PublicationHighlightBadge/);
    assert.doesNotMatch(metadata, /primaryVenue|pub-venue-line/);
    assert.match(source.slice(venueStart), /className="pub-venue-line highlighted-color color-gray">\{primaryVenue\}<\/span>/);
    assert.ok(venueStart < source.indexOf("additionalVenues.map"));
  }
});
