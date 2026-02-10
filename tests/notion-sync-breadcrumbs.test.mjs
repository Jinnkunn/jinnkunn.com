import test from "node:test";
import assert from "node:assert/strict";

import { renderBreadcrumbs } from "../scripts/notion-sync/breadcrumbs.mjs";

test("breadcrumbs: renders Home first and follows parentId chain", () => {
  const home = { id: "a".repeat(32), title: "Hi there!", routePath: "/", parentId: "" };
  const works = { id: "b".repeat(32), title: "Works", routePath: "/works", parentId: home.id };

  const ctx = {
    homePageId: home.id,
    nodeById: new Map([
      [home.id, home],
      [works.id, works],
    ]),
  };

  const html = renderBreadcrumbs(works, {}, ctx);
  assert.match(html, />Home</);
  assert.match(html, />Works</);
  assert.match(html, /notion-breadcrumb__divider/);
});

