import test from "node:test";
import assert from "node:assert/strict";

import {
  extractPublicationStructuredEntries,
  extractPublicationsStructuredItems,
} from "../lib/seo/publications-items.ts";
import { buildPublicationsStructuredData } from "../lib/seo/structured-data.ts";

test("publications-structured-data: extracts publication items from toggle blocks", () => {
  const html = `
    <main class="super-content page__publications">
      <article class="notion-root">
        <h2 class="notion-heading">2026</h2>
        <div class="notion-toggle closed">
          <div class="notion-toggle__summary">
            <span class="notion-semantic-string">
              <strong>Unified Minimax Optimization Framework</strong>
              <em><code class="code"><strong>conference</strong></code></em>
            </span>
          </div>
          <div class="notion-toggle__content">
            <blockquote class="notion-quote">
              <a href="https://arxiv.org/abs/2510.13982" class="notion-link link">https://arxiv.org/abs/2510.13982</a>
            </blockquote>
          </div>
        </div>
      </article>
    </main>
  `;

  const items = extractPublicationsStructuredItems(html);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    title: "Unified Minimax Optimization Framework",
    year: "2026",
    url: "https://arxiv.org/abs/2510.13982",
    labels: ["conference"],
  });
});

test("publications-structured-data: extended extractor reads authors/doi/arxiv", () => {
  const html = `
    <main class="super-content page__publications">
      <article class="notion-root">
        <h2 class="notion-heading">2025</h2>
        <div class="notion-toggle closed">
          <div class="notion-toggle__summary"><strong>Paper A</strong></div>
          <div class="notion-toggle__content">
            <blockquote>J. Chen, A. Smith, and B. Doe</blockquote>
            <blockquote>conference: Test Conference 2025</blockquote>
            <blockquote>
              <a href="https://doi.org/10.1000/test-doi">doi</a>
              <a href="https://arxiv.org/abs/2501.00001">arxiv</a>
            </blockquote>
          </div>
        </div>
      </article>
    </main>
  `;

  const entries = extractPublicationStructuredEntries(html);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].authors, ["J. Chen", "A. Smith", "B. Doe"]);
  assert.equal(entries[0].doiUrl, "https://doi.org/10.1000/test-doi");
  assert.equal(entries[0].arxivUrl, "https://arxiv.org/abs/2501.00001");
  assert.equal(entries[0].venue, "conference: Test Conference 2025");
});

test("publications-structured-data: buildPublicationsStructuredData emits ItemList + ScholarlyArticle", () => {
  const cfg = {
    siteName: "Jinkun Chen.",
    lang: "en",
    seo: {
      title: "Jinkun Chen",
      description: "Personal site.",
      favicon: "/assets/favicon.png",
      ogImage: "/assets/profile.png",
    },
    nav: { top: [], more: [] },
  };
  const data = buildPublicationsStructuredData(cfg, {
    title: "Publications",
    description: "Research publications",
    items: [
      {
        title: "Static Sandboxes Are Inadequate",
        year: "2025",
        url: "https://arxiv.org/abs/2510.13982",
        labels: ["arXiv.org"],
        authors: ["J. Chen", "S. Badshah"],
        externalUrls: ["https://arxiv.org/abs/2510.13982", "https://doi.org/10.1000/x"],
        doiUrl: "https://doi.org/10.1000/x",
      },
    ],
  });

  const itemList = data.find((obj) => obj?.["@type"] === "ItemList");
  assert.ok(itemList);
  assert.equal(itemList.numberOfItems, 1);
  const first = itemList.itemListElement?.[0];
  assert.equal(first?.["@type"], "ListItem");
  assert.equal(first?.item?.["@type"], "ScholarlyArticle");
  assert.equal(first?.item?.headline, "Static Sandboxes Are Inadequate");
  assert.equal(first?.item?.datePublished, "2025-01-01");
  assert.equal(first?.item?.url, "https://doi.org/10.1000/x");
  assert.deepEqual(first?.item?.author, [
    { "@type": "Person", name: "J. Chen" },
    { "@type": "Person", name: "S. Badshah" },
  ]);
  assert.equal(first?.item?.identifier, "https://doi.org/10.1000/x");
});
