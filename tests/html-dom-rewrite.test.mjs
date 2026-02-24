import test from "node:test";
import assert from "node:assert/strict";

import { extractMainElementHtml, rewriteMainHtmlWithDom } from "../lib/server/html-dom-rewrite.ts";

test("html-dom-rewrite: extractMainElementHtml returns standalone main node", () => {
  const html =
    "<!doctype html><html><head><title>x</title></head><body><header>h</header><main id='m'><p>ok</p></main></body></html>";
  const main = extractMainElementHtml(html);
  assert.equal(typeof main, "string");
  assert.equal((main || "").trim().startsWith("<main"), true);
  assert.equal((main || "").includes("<p>ok</p>"), true);
});

test("html-dom-rewrite: rewrites profile assets and lcp attrs, strips profile lightbox attrs", () => {
  const main = `
    <main>
      <figure
        data-full-size="https://cdn.jinkunchen.com/web_image/web-image.png"
        data-lightbox-src="https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/w=1920,quality=90,fit=scale-down"
      >
        <img
          src="https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/public"
          loading="lazy"
          fetchpriority="low"
          onerror="something()"
        />
      </figure>
      <img src="https://assets.super.so/e331c927-5859-4092-b1ca-16eddc17b1bb/uploads/logo/712f74e3-00ca-453b-9511-39896485699f.png" />
    </main>
  `;

  const out = rewriteMainHtmlWithDom(main);

  assert.equal(out.includes("/assets/profile.png"), true);
  assert.equal(out.includes("/assets/logo.png"), true);
  assert.equal(out.includes('loading="eager"'), true);
  assert.equal(out.includes('fetchpriority="high"'), true);
  assert.equal(out.includes("this.onerror=null;this.src='https://cdn.jinkunchen.com/web_image/web-image.png'"), true);
  assert.equal(out.includes("data-full-size="), false);
  assert.equal(out.includes("data-lightbox-src="), false);
});

test("html-dom-rewrite: removes only absolute breadcrumb position style", () => {
  const main = `
    <main>
      <div class="super-navbar__breadcrumbs" style="position:absolute; top: 4px; color: red">
        <a href="/blog/list/post">x</a>
      </div>
    </main>
  `;
  const out = rewriteMainHtmlWithDom(main);
  assert.equal(out.includes("position:absolute"), false);
  assert.equal(out.includes("top:4px"), true);
  assert.equal(out.includes("color:red"), true);
});

test("html-dom-rewrite: adds aria-label for empty links", () => {
  const main = `
    <main>
      <p>
        <span class="highlighted-background bg-yellow">
          <a href="https://example.com/research" class="notion-link link" target="_blank" rel="noopener noreferrer"> </a>
        </span>
      </p>
      <p>
        <a href="/about" class="notion-link link"> </a>
      </p>
    </main>
  `;
  const out = rewriteMainHtmlWithDom(main);
  assert.equal(out.includes('aria-label="Open link to example.com"'), true);
  assert.equal(out.includes('aria-label="Open /about"'), true);
});
