import test from "node:test";
import assert from "node:assert/strict";

import { extractPublicationsStructuredItems } from "../lib/seo/publications-items.ts";
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
  assert.equal(first?.item?.url, "https://arxiv.org/abs/2510.13982");
});
