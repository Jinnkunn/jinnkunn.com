import assert from "node:assert/strict";
import test from "node:test";

import {
  isMdxRuntimeCodeGenerationError,
  renderHomePreviewShellHtml,
  renderMdxPreviewHtml,
} from "../lib/site-admin/mdx-preview-render.ts";

test("site-admin mdx preview renderer handles home columns without runtime eval", () => {
  const html = renderMdxPreviewHtml(
    [
      "---",
      'title: "Home"',
      "---",
      '<Columns count={2} variant="classicIntro">',
      "<Column>",
      "",
      "![Jinkun Chen](https://cdn.jinkunchen.com/avatar.png)",
      "",
      "</Column>",
      "<Column>",
      "",
      "Hello **world** from [Dalhousie](https://www.dal.ca/).",
      "",
      "</Column>",
      "</Columns>",
    ].join("\n"),
  );

  assert.match(html, /home-layout--variant-classicIntro/);
  assert.match(html, /home-layout__column/);
  assert.match(html, /<img src="https:\/\/cdn\.jinkunchen\.com\/avatar\.png" alt="Jinkun Chen"/);
  assert.match(html, /<strong>world<\/strong>/);
  assert.match(html, /class="notion-link link"/);
});

test("site-admin home preview shell includes classic page frame", () => {
  const html = renderHomePreviewShellHtml({
    title: "Hi there!",
    bodyMdx: "Body",
  });

  assert.match(html, /id="main-content"/);
  assert.match(html, /page__index/);
  assert.match(html, /notion-header__title/);
  assert.match(html, /mdx-post__body/);
});

test("site-admin mdx preview renderer detects Cloudflare codegen failures", () => {
  assert.equal(
    isMdxRuntimeCodeGenerationError(
      new Error("Code generation from strings disallowed for this context"),
    ),
    true,
  );
  assert.equal(isMdxRuntimeCodeGenerationError(new Error("ordinary MDX syntax error")), false);
});
