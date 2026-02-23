import test from "node:test";
import assert from "node:assert/strict";

import { rewritePublicationsHtml } from "../lib/publications/rewrite.ts";

test("publications-rewrite: leaves non-publication pages untouched", () => {
  const input = `<main class="super-content page__works"><p>hello</p></main>`;
  assert.equal(rewritePublicationsHtml(input), input);
});

test("publications-rewrite: normalizes tag separator and wraps tag+colon", () => {
  const input =
    `<main class="super-content page__publications">` +
    `<blockquote class="notion-quote"><span class="notion-semantic-string">` +
    `<em><span class="highlighted-color color-red"><span class="highlighted-background bg-red"><code class="code"><strong>conference</strong></code></span></span></em>` +
    `<strong>: </strong><span class="highlighted-color color-gray">AAAI</span>` +
    `</span></blockquote></main>`;

  const out = rewritePublicationsHtml(input);

  assert.match(out, /class="pub-tag-prefix"/);
  assert.match(out, /class="pub-tag-colon"><strong>:\s<\/strong><\/span>/);
  assert.doesNotMatch(out, /<strong>\s*:\s*<\/strong><span class="highlighted-color color-gray">AAAI/);
});

test("publications-rewrite: supports default-colored ':' markers from notion", () => {
  const input =
    `<main class="super-content page__publications">` +
    `<blockquote class="notion-quote"><span class="notion-semantic-string">` +
    `<em><span class="highlighted-color color-purple"><span class="highlighted-background bg-purple"><code class="code"><strong>arXiv.org</strong></code></span></span></em>` +
    `<span class="highlighted-color color-default"><span class="highlighted-background bg-default">:</span></span>` +
    `<span class="highlighted-color color-gray">Available at</span>` +
    `</span></blockquote></main>`;

  const out = rewritePublicationsHtml(input);

  assert.match(out, /class="pub-tag-prefix"/);
  assert.match(out, /arXiv\.org/);
  assert.match(out, /class="pub-tag-colon"><strong>:\s<\/strong><\/span>/);
});

test("publications-rewrite: removes empty highlighted chips", () => {
  const input =
    `<main class="super-content page__publications">` +
    `<blockquote class="notion-quote"><span class="notion-semantic-string">` +
    `<span class="highlighted-color color-gray">Authors</span>` +
    `<em><span class="highlighted-color color-red"><span class="highlighted-background bg-red"><strong>\n</strong></span></span></em>` +
    `<em><span class="highlighted-color color-red"><span class="highlighted-background bg-red"><code class="code"><strong>conference</strong></code></span></span></em>` +
    `<strong>: </strong><span class="highlighted-color color-gray">AAAI</span>` +
    `</span></blockquote></main>`;

  const out = rewritePublicationsHtml(input);

  assert.doesNotMatch(out, /<span class="highlighted-background bg-red"><strong>\s*<\/strong><\/span>/);
  assert.match(out, /conference/);
});
