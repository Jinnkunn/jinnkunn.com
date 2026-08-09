import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { registerNextModuleHooks } from "../helpers/next-module-hooks.mjs";
import { registerServerModuleHooks } from "../helpers/server-module-hooks.mjs";

const ROOT = process.cwd();

// `lib/server/*` is written for the Next runtime. Both helpers are needed:
// one maps `server-only` + the `@/` alias + bare JSON imports, the other
// resolves the extensionless relative imports the content store uses. With
// them the real renderer runs here, so the feed is asserted on its output
// rather than on its source text.
registerNextModuleHooks();
registerServerModuleHooks();

const rss = await import("../../lib/server/rss.ts");
const seo = await import("../../lib/seo/metadata.ts");
const blogRss = await import("../../lib/server/blog-rss.ts");
const { CLASSIC_LINK_ICON_CONTRACT } = await import("../../scripts/_lib/classic-link-icons.mjs");

async function read(relPath) {
  return await fs.readFile(path.join(ROOT, relPath), "utf8");
}

async function exists(relPath) {
  try {
    await fs.stat(path.join(ROOT, relPath));
    return true;
  } catch {
    return false;
  }
}

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

test("feed: the retired static Super feeds are gone from the repo", async () => {
  assert.equal(await exists("public/blog.rss"), false);
  assert.equal(await exists("public/blog.atom"), false);
});

test("feed: nothing advertises /blog.rss as a live feed source", async () => {
  const blogPage = await read("app/(classic)/blog/page.tsx");
  const llms = await read("app/llms.txt/route.ts");

  assert.ok(
    !blogPage.includes("/blog.rss"),
    "blog index must link the dynamic feed, not the retired static file",
  );
  assert.ok(blogPage.includes("FEED_PATH"), "blog index links the shared feed path");
  assert.ok(!llms.includes("/blog.rss"), "llms.txt must not point at the retired feed");
  assert.equal(seo.FEED_PATH, "/rss.xml");
});

test("feed: /blog.rss and /blog.atom permanently redirect to the live feed", async () => {
  for (const route of ["app/blog.rss/route.ts", "app/blog.atom/route.ts"]) {
    const source = await read(route);
    assert.ok(source.includes("legacyFeedRedirect"), `${route} should redirect`);
  }

  const res = rss.legacyFeedRedirect(new Request("https://jinkunchen.com/blog.rss"));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://jinkunchen.com/rss.xml");
  assert.equal(rss.CANONICAL_FEED_PATH, "/rss.xml");

  // A 301 is cached hard by clients, so it has to stay on the host the
  // request arrived on — a staging visitor must never be pinned to prod.
  const staging = rss.legacyFeedRedirect(
    new Request("https://example.workers.dev/blog.atom", {
      headers: { host: "staging.jinkunchen.com" },
    }),
  );
  assert.equal(staging.headers.get("location"), "https://staging.jinkunchen.com/rss.xml");
});

test("feed: generated RSS carries item descriptions, self link and language", () => {
  const xml = rss.buildRssXml({
    channelTitle: "Blog",
    channelLink: "https://jinkunchen.com/blog",
    channelDescription: "Jinkun's Blog",
    selfLink: "https://jinkunchen.com/rss.xml",
    language: "en",
    items: [
      {
        title: "Post A",
        link: "https://jinkunchen.com/blog/post-a",
        pubDate: "Sun, 26 Apr 2026 00:00:00 GMT",
        description: "A & B <summary>",
      },
    ],
  });

  assert.match(xml, /<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<language>en<\/language>/);
  assert.match(
    xml,
    /<atom:link href="https:\/\/jinkunchen\.com\/rss\.xml" rel="self" type="application\/rss\+xml"\/>/,
  );
  assert.match(xml, /<description>A &amp; B &lt;summary&gt;<\/description>/);
});

test("feed: blank optional fields stay omitted rather than emitted empty", () => {
  const xml = rss.buildRssXml({
    channelTitle: "Blog",
    channelLink: "https://jinkunchen.com/blog",
    channelDescription: "Jinkun's Blog",
    // Whitespace and null are what the post store actually hands over for a
    // post with no extractable summary; neither may produce an empty element.
    selfLink: "   ",
    language: null,
    items: [
      { title: "Post A", link: "https://jinkunchen.com/blog/post-a", description: "   " },
      { title: "Post B", link: "https://jinkunchen.com/blog/post-b", description: null },
    ],
  });

  assert.ok(!xml.includes("<language>"));
  assert.ok(!xml.includes("<atom:link"));
  // The channel description is still required; only the per-item one is optional.
  assert.equal(xml.match(/<description>/g).length, 1);
});

test("feed: the live renderer emits descriptions and a per-path self link", async () => {
  const canonical = await blogRss
    .renderBlogRss(new Request("https://jinkunchen.com/rss.xml"))
    .then((res) => res.text());
  const blogMount = await blogRss
    .renderBlogRss(new Request("https://jinkunchen.com/blog/rss.xml"))
    .then((res) => res.text());

  // Same renderer, two mounts: rel="self" must follow the request, not be
  // pinned to whichever path happened to be hardcoded.
  assert.match(
    canonical,
    /<atom:link href="https:\/\/jinkunchen\.com\/rss\.xml" rel="self"/,
  );
  assert.match(
    blogMount,
    /<atom:link href="https:\/\/jinkunchen\.com\/blog\/rss\.xml" rel="self"/,
  );
  assert.match(canonical, /<language>en<\/language>/);
  // Channel description plus at least one real item description.
  assert.ok(
    (canonical.match(/<description>/g) || []).length > 1,
    "published posts should carry their summary into the feed",
  );
});

test("feed: the RSS icon probes track the link registry", async () => {
  // The two browser QA scripts hardcode the RSS selector while the CSS and
  // the workspace editor derive theirs from the registry. Nothing else pins
  // the two together, so a half-finished feed-path rename would only surface
  // post-deploy, in a check that needs a live server to run.
  const registrySelector = CLASSIC_LINK_ICON_CONTRACT.find(
    (item) => item.asset === "/web_image/rss.svg",
  )?.selector;
  assert.equal(
    registrySelector,
    'span[data-link-style="icon"] > a[href="/rss.xml"].notion-link.link',
  );

  for (const script of [
    "scripts/qa/classic-style-contract.mjs",
    "scripts/qa/production-style-regression.mjs",
  ]) {
    const source = await read(script);
    assert.ok(
      source.includes(registrySelector),
      `${script} should probe the registry's RSS selector`,
    );
  }

  // …and the public stylesheet has to actually paint that selector.
  const css = await read("public/styles/super-inline.css");
  assert.ok(css.includes(`${registrySelector}:before`), "super-inline.css paints the RSS icon");
});

test("seo: every page advertises the feed for autodiscovery", () => {
  const page = seo.buildPageMetadata({
    cfg,
    title: "Post A",
    description: "desc",
    pathname: "/blog/post-a",
  });
  const root = seo.buildRootMetadata(cfg);

  for (const meta of [page, root]) {
    const types = meta.alternates?.types;
    assert.ok(types, "alternates.types should carry the feed link");
    assert.deepEqual(types["application/rss+xml"], [{ url: "/rss.xml", title: "Blog" }]);
  }
});

test("seo: /pages/<slug> canonicalises to the bare /<slug> mount", async () => {
  const pagesRoute = await read("app/(classic)/pages/[...slug]/page.tsx");

  assert.match(pagesRoute, /const canonicalPathname = `\/\$\{joined\}`;/);
  assert.ok(
    !/pathname: `\/pages\//.test(pagesRoute),
    "/pages/<slug> must not self-canonicalise",
  );

  // The canonical the metadata builder derives from that pathname is the
  // root mount, and the root catch-all agrees with it.
  const viaPagesMount = seo.buildPageMetadata({
    cfg,
    title: "About",
    pathname: "/about",
  });
  assert.equal(viaPagesMount.alternates.canonical, "/about");
  assert.equal(seo.canonicalPath("/about"), "/about");
});
