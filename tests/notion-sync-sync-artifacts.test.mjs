import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRouteManifest,
  writeSyncArtifacts,
} from "../scripts/notion-sync/sync-artifacts.mjs";

test("sync-artifacts: buildRouteManifest maps nav group and override flag", () => {
  const allPages = [
    {
      id: "a".repeat(32),
      title: "Home",
      kind: "page",
      routePath: "/",
      parentId: "",
      parentRoutePath: "/",
    },
    {
      id: "b".repeat(32),
      title: "News",
      kind: "page",
      routePath: "/news",
      parentId: "a".repeat(32),
      parentRoutePath: "/",
    },
  ];
  const cfg = {
    nav: {
      top: [{ href: "/" }, { href: "/news/" }],
      more: [{ href: "/teaching/" }],
    },
  };
  const routeOverrides = new Map([["b".repeat(32), "/latest-news"]]);

  const out = buildRouteManifest(allPages, cfg, routeOverrides);
  assert.equal(out.length, 2);
  assert.equal(out[0].navGroup, "top");
  assert.equal(out[0].overridden, false);
  assert.equal(out[1].navGroup, "top");
  assert.equal(out[1].overridden, true);
});

test("sync-artifacts: writeSyncArtifacts writes routes/search/manifest files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-artifacts-"));
  try {
    const allPages = [
      {
        id: "a".repeat(32),
        title: "Home",
        kind: "page",
        routePath: "/",
        parentId: "",
        parentRoutePath: "/",
      },
      {
        id: "b".repeat(32),
        title: "Publications",
        kind: "page",
        routePath: "/publications",
        parentId: "a".repeat(32),
        parentRoutePath: "/",
      },
    ];
    const cfg = { nav: { top: [{ href: "/" }], more: [] } };
    const routeOverrides = new Map();
    const searchIndex = [
      { id: "a".repeat(32), title: "Home", kind: "page", routePath: "/", text: "hi there" },
    ];

    writeSyncArtifacts({ outDir: tmp, allPages, cfg, routeOverrides, searchIndex });

    const routes = JSON.parse(fs.readFileSync(path.join(tmp, "routes.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, "routes-manifest.json"), "utf8"));
    const search = JSON.parse(fs.readFileSync(path.join(tmp, "search-index.json"), "utf8"));

    assert.equal(routes["/"], "a".repeat(32));
    assert.equal(routes["/publications"], "b".repeat(32));
    assert.equal(manifest.length, 2);
    assert.equal(manifest[0].title, "Home");
    assert.equal(search.length, 1);
    assert.equal(search[0].routePath, "/");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
