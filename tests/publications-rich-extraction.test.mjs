import test from "node:test";
import assert from "node:assert/strict";

import { extractPublicationStructuredEntries } from "../lib/seo/publications-items.ts";
import { extractProfileLinks, extractPageTitle } from "../lib/publications/extract.ts";

const BASE_HTML = `
<main class="super-content page__publications">
  <article class="notion-root">
    <p class="notion-text">
      <a href="https://scholar.google.ca/citations?user=x" target="_blank">Google Scholar</a>
      <strong> | </strong>
      <a href="https://www.researchgate.net/profile/x" target="_blank">ResearchGate</a>
      <strong> | </strong>
      <a href="https://orcid.org/0009-0004-5792-2097" target="_blank">ORCID</a>
    </p>
    <h2 class="notion-heading">2026</h2>
    <div class="notion-toggle closed">
      <div class="notion-toggle__summary">
        <span class="notion-semantic-string">
          <strong>Unified Minimax Framework</strong>
          <span class="highlighted-color color-red"><strong>[oral]</strong></span>
          <em><code class="code"><strong>conference</strong></code></em>
        </span>
      </div>
      <div class="notion-toggle__content">
        <blockquote class="notion-quote">
          <span class="highlighted-color color-gray">C. Zheng; H. Yang, </span>
          <strong><u>J. Chen</u></strong>
          <span class="highlighted-color color-gray">, S. Zhang, T. Xia</span>
          <br><br>
          <em><code class="code"><strong>conference</strong></code></em>
          <strong>: </strong>
          <span class="highlighted-color color-gray">AAAI-26</span>
        </blockquote>
      </div>
    </div>
    <h2 class="notion-heading">2024</h2>
    <div class="notion-toggle closed">
      <div class="notion-toggle__summary">
        <span class="notion-semantic-string">
          <strong>CAB-KWS</strong>
          <em><code class="code"><strong>conference</strong></code></em>
          <em><code class="code"><strong>journal</strong></code></em>
          <em><code class="code"><strong>arXiv.org</strong></code></em>
        </span>
      </div>
      <div class="notion-toggle__content">
        <blockquote class="notion-quote">
          <span>W. Dai, Y. Jiang, Y. Liu, </span>
          <strong><u>J. Chen</u></strong>
          <span>, X. Sun, and J. Tao</span>
          <br><br>
          <em><code class="code"><strong>conference</strong></code></em><strong>: </strong>
          <span>27th ICPR</span><br>
          <em><code class="code"><strong>journal</strong></code></em><strong>: </strong>
          <span>LNCS vol 15303. Springer. dio: </span>
          <a href="https://doi.org/10.1007/978-3-031-78122-3_7">DOI</a>.<br>
          <em><code class="code"><strong>arXiv.org</strong></code></em><strong>: </strong>
          <span>Available at: </span>
          <a href="https://arxiv.org/abs/2409.00356">arxiv</a>
        </blockquote>
      </div>
    </div>
  </article>
</main>
`;

test("rich extract: highlights captured and not mixed with labels", () => {
  const entries = extractPublicationStructuredEntries(BASE_HTML);
  const first = entries.find((e) => e.title === "Unified Minimax Framework");
  assert.ok(first);
  assert.deepEqual(first.labels, ["conference"]);
  assert.deepEqual(first.highlights, ["oral"]);
});

test("rich extract: authorsRich marks self-author via <strong><u>", () => {
  const entries = extractPublicationStructuredEntries(BASE_HTML);
  const first = entries.find((e) => e.title === "Unified Minimax Framework");
  assert.ok(first);
  const rich = first.authorsRich ?? [];
  assert.equal(rich.length, 5);
  const self = rich.find((a) => a.isSelf);
  assert.ok(self);
  assert.equal(self.name, "J. Chen");
  const others = rich.filter((a) => !a.isSelf).map((a) => a.name);
  assert.deepEqual(others, ["C. Zheng", "H. Yang", "S. Zhang", "T. Xia"]);
});

test("rich extract: authors do not bleed into venue text", () => {
  const entries = extractPublicationStructuredEntries(BASE_HTML);
  const first = entries.find((e) => e.title === "Unified Minimax Framework");
  assert.ok(first);
  const names = (first.authorsRich ?? []).map((a) => a.name).join("|");
  assert.ok(!names.toLowerCase().includes("aaai"));
  assert.ok(!names.toLowerCase().includes("conference:"));
});

test("rich extract: multi-label entry produces per-label venues with correct URLs", () => {
  const entries = extractPublicationStructuredEntries(BASE_HTML);
  const second = entries.find((e) => e.title === "CAB-KWS");
  assert.ok(second);
  assert.deepEqual(second.labels, ["conference", "journal", "arXiv.org"]);
  const venues = second.venues ?? [];
  assert.equal(venues.length, 3);

  const byType = Object.fromEntries(venues.map((v) => [v.type.toLowerCase(), v]));
  assert.ok(byType.conference.text.includes("27th ICPR"));
  assert.equal(byType.conference.url, undefined);

  assert.ok(byType.journal.text.includes("LNCS vol 15303"));
  assert.equal(byType.journal.url, "https://doi.org/10.1007/978-3-031-78122-3_7");

  assert.equal(byType["arxiv.org"].url, "https://arxiv.org/abs/2409.00356");
});

test("rich extract: doi/arxiv URLs still resolve at top level", () => {
  const entries = extractPublicationStructuredEntries(BASE_HTML);
  const second = entries.find((e) => e.title === "CAB-KWS");
  assert.ok(second);
  assert.equal(second.doiUrl, "https://doi.org/10.1007/978-3-031-78122-3_7");
  assert.equal(second.arxivUrl, "https://arxiv.org/abs/2409.00356");
});

test("profile-links: extracts ordered academic profile links from intro", () => {
  const links = extractProfileLinks(BASE_HTML);
  assert.equal(links.length, 3);
  assert.equal(links[0].label, "Google Scholar");
  assert.equal(links[0].hostname, "scholar.google.ca");
  assert.equal(links[2].label, "ORCID");
  assert.equal(links[2].hostname, "orcid.org");
});

test("profile-links: stops at the first year heading", () => {
  const html = `
    <main class="super-content page__publications">
      <article class="notion-root">
        <p class="notion-text"><a href="https://scholar.google.com/">Scholar</a></p>
        <h2 class="notion-heading">2024</h2>
        <div class="notion-toggle closed">
          <div class="notion-toggle__summary">
            <span class="notion-semantic-string">
              <strong>Paper</strong>
              <em><code class="code">conference</code></em>
            </span>
          </div>
          <div class="notion-toggle__content">
            <blockquote>
              <a href="https://example.com/not-a-profile">nope</a>
            </blockquote>
          </div>
        </div>
      </article>
    </main>
  `;
  const links = extractProfileLinks(html);
  assert.deepEqual(
    links.map((l) => l.href),
    ["https://scholar.google.com/"],
  );
});

test("extractPageTitle: reads H1 from notion-header", () => {
  const html = `
    <main class="super-content page__publications">
      <div class="notion-header page">
        <div class="notion-header__content"><h1 class="notion-header__title">Publications</h1></div>
      </div>
      <article class="notion-root"></article>
    </main>
  `;
  assert.equal(extractPageTitle(html), "Publications");
});

test("rich extract: orphan authors keep correct order when no venue label present", () => {
  const html = `
    <main class="super-content page__publications">
      <article class="notion-root">
        <h2 class="notion-heading">2024</h2>
        <div class="notion-toggle closed">
          <div class="notion-toggle__summary">
            <span class="notion-semantic-string">
              <strong>Plain Paper</strong>
            </span>
          </div>
          <div class="notion-toggle__content">
            <blockquote>
              <span>Alice, Bob, </span><strong><u>J. Chen</u></strong><span>, Dan</span>
            </blockquote>
          </div>
        </div>
      </article>
    </main>
  `;
  const entries = extractPublicationStructuredEntries(html);
  assert.equal(entries.length, 1);
  const rich = entries[0].authorsRich ?? [];
  assert.deepEqual(
    rich.map((a) => `${a.name}${a.isSelf ? "*" : ""}`),
    ["Alice", "Bob", "J. Chen*", "Dan"],
  );
});
