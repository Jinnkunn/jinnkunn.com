import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPageMetadata,
  buildRootMetadata,
  canonicalPath,
  detectSiteOrigin,
  normalizeSiteOrigin,
} from "../lib/seo/metadata.ts";

const cfg = {
  siteName: "Jinkun Chen.",
  lang: "en",
  seo: {
    title: "Jinkun Chen",
    description: "Research homepage",
    favicon: "/assets/favicon.png",
    ogImage: "/assets/profile.png",
    pageOverrides: {},
  },
  nav: { top: [], more: [] },
};

test("seo-metadata: normalizeSiteOrigin handles domain and url forms", () => {
  assert.equal(normalizeSiteOrigin("jinkunchen.com"), "https://jinkunchen.com");
  assert.equal(normalizeSiteOrigin("https://jinkunchen.com/"), "https://jinkunchen.com");
  assert.equal(normalizeSiteOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeSiteOrigin(""), null);
});

test("seo-metadata: detectSiteOrigin respects precedence", () => {
  assert.equal(
    detectSiteOrigin({
      NEXT_PUBLIC_SITE_URL: "https://a.example",
      SITE_URL: "https://b.example",
      VERCEL_PROJECT_PRODUCTION_URL: "c.example",
    }),
    "https://a.example",
  );
  assert.equal(
    detectSiteOrigin({
      NEXT_PUBLIC_SITE_URL: "",
      SITE_URL: "",
      VERCEL_PROJECT_PRODUCTION_URL: "prod.example",
    }),
    "https://prod.example",
  );
});

test("seo-metadata: canonicalPath normalizes blog list helpers", () => {
  assert.equal(canonicalPath("/blog/list/post-a"), "/blog/post-a");
  assert.equal(canonicalPath("/list/post-a"), "/blog/post-a");
  assert.equal(canonicalPath(""), "/");
});

test("seo-metadata: buildPageMetadata emits canonical + openGraph", () => {
  const out = buildPageMetadata({
    cfg,
    title: "Post A",
    description: "desc",
    pathname: "/blog/post-a",
    type: "article",
    publishedTime: "2026-02-01",
  });

  assert.equal(out.alternates?.canonical, "/blog/post-a");
  assert.equal(out.openGraph?.type, "article");
  assert.equal(out.twitter?.card, "summary_large_image");
  assert.deepEqual(out.openGraph?.images, [{ url: "/assets/profile.png" }]);
  assert.deepEqual(out.twitter?.images, ["/assets/profile.png"]);
});

test("seo-metadata: buildRootMetadata uses configured social image", () => {
  const out = buildRootMetadata(cfg);
  assert.deepEqual(out.openGraph?.images, [{ url: "/assets/profile.png" }]);
  assert.deepEqual(out.twitter?.images, ["/assets/profile.png"]);
});

test("seo-metadata: page override can set canonical/image/noindex", () => {
  const out = buildPageMetadata({
    cfg: {
      ...cfg,
      seo: {
        ...cfg.seo,
        pageOverrides: {
          "/blog/post-a": {
            title: "Custom Title",
            description: "Custom Description",
            ogImage: "https://cdn.example.com/og.png",
            canonicalPath: "/blog/post-canonical",
            noindex: true,
          },
        },
      },
    },
    title: "Fallback Title",
    description: "fallback",
    pathname: "/blog/post-a",
    type: "article",
  });

  assert.equal(out.title, "Custom Title");
  assert.equal(out.description, "Custom Description");
  assert.equal(out.alternates?.canonical, "/blog/post-canonical");
  assert.deepEqual(out.openGraph?.images, [{ url: "https://cdn.example.com/og.png" }]);
  assert.deepEqual(out.twitter?.images, ["https://cdn.example.com/og.png"]);
  assert.deepEqual(out.robots, { index: false, follow: false });
});
