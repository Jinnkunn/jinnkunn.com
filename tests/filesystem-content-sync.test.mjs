import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILESYSTEM_SYNC_MODULE =
  pathToFileURL(path.join(REPO_ROOT, "scripts", "content-sync", "filesystem-source.mjs")).href;

test("filesystem sync: compiles mdx pages into generated runtime artifacts", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jinnkunn-filesystem-sync-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tmpDir);
    await fs.mkdir(path.join(tmpDir, "content", "filesystem", "pages"), { recursive: true });

    await fs.writeFile(
      path.join(tmpDir, "content", "filesystem", "site-config.json"),
      JSON.stringify(
        {
          siteName: "Filesystem Test",
          nav: {
            top: [{ label: "Home", href: "/", order: 0, enabled: true }],
            more: [],
          },
          content: {
            routeOverrides: {},
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tmpDir, "content", "filesystem", "routes-manifest.json"),
      JSON.stringify([], null, 2) + "\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tmpDir, "content", "filesystem", "protected-routes.json"),
      JSON.stringify(
        [
          {
            id: "protected-home",
            pageId: "home-page",
            path: "/",
            mode: "exact",
            auth: "password",
            token: "hashed-token",
            key: "pageId",
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tmpDir, "content", "filesystem", "pages", "index.mdx"),
      `---
title: Filesystem Home
description: MDX-backed homepage
date: 2026-04-21
author: Codex
---

# Hello Filesystem

This page is rendered from **MDX**.
`,
      "utf8",
    );

    const { syncFilesystemContent } = await import(`${FILESYSTEM_SYNC_MODULE}?t=${Date.now()}`);
    await syncFilesystemContent();

    const siteConfig = JSON.parse(
      await fs.readFile(path.join(tmpDir, "content", "generated", "site-config.json"), "utf8"),
    );
    const routeManifest = JSON.parse(
      await fs.readFile(path.join(tmpDir, "content", "generated", "routes-manifest.json"), "utf8"),
    );
    const protectedRoutes = JSON.parse(
      await fs.readFile(path.join(tmpDir, "content", "generated", "protected-routes.json"), "utf8"),
    );
    const searchIndex = JSON.parse(
      await fs.readFile(path.join(tmpDir, "content", "generated", "search-index.json"), "utf8"),
    );
    const syncMeta = JSON.parse(
      await fs.readFile(path.join(tmpDir, "content", "generated", "sync-meta.json"), "utf8"),
    );
    const mainHtml = await fs.readFile(
      path.join(tmpDir, "content", "generated", "raw", "index.html"),
      "utf8",
    );

    assert.equal(siteConfig.siteName, "Filesystem Test");
    assert.deepEqual(siteConfig.nav.top, [{ label: "Home", href: "/" }]);
    assert.equal(routeManifest.some((route) => route.routePath === "/"), true);
    assert.equal(protectedRoutes.length, 1);
    assert.equal(searchIndex.length, 1);
    assert.equal(searchIndex[0].title, "Filesystem Home");
    assert.equal(syncMeta.contentSource, "filesystem");
    assert.match(mainHtml, /Filesystem Home/);
    assert.match(mainHtml, /Hello Filesystem/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
