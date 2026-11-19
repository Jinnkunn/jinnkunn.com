import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { publicationListMetadata, venueSummaryText } from "../../components/publications/labels.ts";
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
  assert.deepEqual(publicationListMetadata({ venues }), {
    typeLabels: ["Journal"],
    venueLines: ["SoftwareX, vol 28, 101952. Elsevier"],
  });
  assert.deepEqual(venues, before);
});

test("publication presentation: preserves meaningful additional venue descriptions, without embedded URLs", () => {
  const venues = [
    { type: "conference", text: "27th International Conference on Pattern Recognition (ICPR)" },
    { type: "journal", text: "Pattern Recognition. Lecture Notes in Computer Science, vol 15303. Springer, Cham. dio: https://doi.org/10.1007/example", url: "https://doi.org/10.1007/example" },
    { type: "arXiv.org", text: "Available at: https://arxiv.org/abs/2409.00356" },
    { type: "workshop", text: "Extended workshop version" },
  ];
  assert.deepEqual(publicationListMetadata({ venues }), {
    typeLabels: ["Conference", "Journal", "Workshop"],
    venueLines: [
      "27th International Conference on Pattern Recognition (ICPR)",
      "Pattern Recognition. Lecture Notes in Computer Science, vol 15303. Springer, Cham",
      "Extended workshop version",
    ],
  });
});

test("publication presentation: one Preprint type without a redundant repository venue", () => {
  assert.deepEqual(publicationListMetadata({
    labels: ["arXiv.org", "Preprint", " Research note ", "RESEARCH NOTE", " "],
    venues: [{ type: "arXiv", text: "arXiv preprint. Available at: https://arxiv.org/abs/2510.13982" }],
  }), { typeLabels: ["Preprint", "Research note"], venueLines: [] });
  assert.deepEqual(publicationListMetadata({
    labels: ["arxiv"],
    venues: [{ type: "preprint", text: "Institutional working paper series" }],
  }), { typeLabels: ["Preprint"], venueLines: ["Institutional working paper series"] });
});

test("publication presentation: empty and legacy venue fields do not create duplicate metadata", () => {
  assert.deepEqual(publicationListMetadata({}), { typeLabels: [], venueLines: [] });
  assert.deepEqual(publicationListMetadata({ labels: ["conference"], venue: "AAAI-26" }), {
    typeLabels: ["Conference"], venueLines: ["AAAI-26"],
  });
  assert.deepEqual(publicationListMetadata({
    venues: [{ type: "journal", text: "SoftwareX" }, { type: "journal", text: "SoftwareX." }],
    venue: "SoftwareX",
  }), { typeLabels: ["Journal"], venueLines: ["SoftwareX"] });
});

test("publication search keeps the arXiv synonym without displaying raw URLs", () => {
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

test("publication presentation: real preprint and published entries keep their resource links and meaningful venues", async () => {
  const source = await readFile(new URL("../../content/components/publications.mdx", import.meta.url), "utf8");
  const entries = parsePublicationsEntries(source);
  const maritime = entries.find((entry) => entry.title.includes("AISDB"));
  const cab = entries.find((entry) => entry.title.startsWith("CAB-KWS"));
  const preprint = entries.find((entry) => entry.title.startsWith("Static Sandboxes"));
  assert.ok(maritime);
  assert.ok(cab);
  assert.ok(preprint);
  assert.deepEqual(publicationListMetadata(preprint), { typeLabels: ["Preprint"], venueLines: [] });
  assert.deepEqual(publicationLinks(preprint), [{ href: "https://arxiv.org/abs/2510.13982", label: "arXiv" }]);
  assert.deepEqual(publicationListMetadata(maritime), {
    typeLabels: ["Journal"],
    venueLines: ["SoftwareX, vol 28, 101952. Elsevier"],
  });
  assert.deepEqual(publicationLinks(maritime).map(({ label }) => label), ["DOI", "arXiv"]);
  const { typeLabels, venueLines } = publicationListMetadata(cab);
  assert.deepEqual(typeLabels, ["Conference", "Journal"]);
  assert.equal(venueLines.length, 2);
  assert.match(venueLines[1], /Lecture Notes in Computer Science/);
  assert.doesNotMatch(venueLines.join(" "), /https?:|\b(?:doi|dio):|Available at/i);
  assert.deepEqual(publicationLinks(cab).map(({ label }) => label), ["DOI", "arXiv"]);
});

test("publication presentation: both rendering paths keep venue metadata in the summary and authors alone in expanded content", async () => {
  const inline = await readFile(new URL("../../components/posts-mdx/publications-entry.tsx", import.meta.url), "utf8");
  assert.match(inline, /<PublicationRow entry=/);
  const source = await readFile(new URL("../../components/publications/publication-list.tsx", import.meta.url), "utf8");
  const [summary, expanded] = source.split('<div className="notion-toggle__content"');
  assert.ok(expanded);
  assert.match(summary, /venueLines\.map/);
  assert.match(summary, /pub-venue-line highlighted-color color-gray/);
  assert.ok(summary.indexOf("venueLines.map") < summary.indexOf("<PublicationResourceLinks"));
  assert.match(summary, /const hasAuthors = authors\.length > 0/);
  assert.match(summary, /aria-label=\{`Authors of \$\{title\}`\}/);
  assert.match(expanded, /<AuthorsLine/);
  assert.doesNotMatch(expanded, /venueLines|pub-type-tag|PublicationResourceLinks|<br/);
});

test("publication presentation: the shared row puts the venue below labels and highlights", async () => {
  const source = await readFile(new URL("../../components/publications/publication-list.tsx", import.meta.url), "utf8");
  assert.match(source, /const hasMetadata = typeLabels\.length > 0 \|\| highlights\.length > 0;/);
  const metadataStart = source.indexOf("{hasMetadata &&");
  const venueStart = source.indexOf("{venueLines.map", metadataStart);
  assert.ok(metadataStart >= 0 && venueStart > metadataStart);
  const metadata = source.slice(metadataStart, venueStart);
  assert.match(metadata, /pub-meta-line ds-meta-row/);
  assert.match(metadata, /PublicationHighlightBadge/);
  assert.match(metadata, /className="pub-type-tag" variant="outline"/);
  assert.doesNotMatch(metadata, /pub-venue-line|highlighted-background|<code/);
  assert.ok(venueStart < source.indexOf("<PublicationResourceLinks"));
});
