/* Sync content from Notion into `content/generated/` so the site can be deployed
 * without Super.so.
 *
 * High-level:
 * - A Notion "Site Admin" page stores site config (JSON code block).
 * - The admin page's child pages (recursive) are compiled into `content/generated/raw/<route>.html`.
 * - Deploys are triggered from /site-admin, which calls the signed /api/deploy endpoint.
 *
 * Required env:
 * - NOTION_TOKEN: Notion internal integration token
 * - NOTION_SITE_ADMIN_PAGE_ID: Notion page id (or URL) for the admin page
 *
 * Optional:
 * - NOTION_VERSION: Notion API version (default: 2022-06-28)
 * - NOTION_SYNC_FORCE=1: re-download assets even if they exist
 */

import path from "node:path";
import katex from "katex";

import { DEFAULT_SITE_CONFIG } from "../lib/shared/default-site-config.mjs";
import { deepMerge, isObject } from "../lib/shared/object-utils.mjs";
import {
  findFirstJsonCodeBlock,
} from "../lib/notion/index.mjs";
import { compactId, normalizeRoutePath } from "../lib/shared/route-utils.mjs";
import { escapeHtml } from "../lib/shared/text-utils.mjs";
import { ensureDir, rmDir, writeFile } from "./notion-sync/fs-utils.mjs";
import {
  loadConfigFromAdminDatabases,
  loadIncludedPagesFromAdminDatabases,
  loadProtectedRoutesFromAdminDatabases,
} from "./notion-sync/site-admin-dbs.mjs";
import {
  assignRoutes,
  flattenPages,
  pickHomePageId,
} from "./notion-sync/route-model.mjs";
import { renderPagesAndBuildSearchIndex } from "./notion-sync/page-render-sync.mjs";
import {
  getPageTitle,
} from "./notion-sync/page-meta.mjs";
import { createPageTreeBuilder } from "./notion-sync/page-tree.mjs";
import { createAssetDownloader } from "./notion-sync/asset-cache.mjs";
import { writeSyncArtifacts } from "./notion-sync/sync-artifacts.mjs";

const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "content", "generated");
const OUT_RAW_DIR = path.join(OUT_DIR, "raw");
const OUT_PUBLIC_ASSETS_DIR = path.join(ROOT, "public", "notion-assets");

// Best-effort build cache:
// - On Vercel, `.next/cache` is cached between builds, so this can dramatically reduce sync time.
// - Cache is always validated using Notion `last_edited_time` (page/database), so it's safe to reuse.
const CACHE_DIR = path.join(ROOT, ".next", "cache", "notion-sync");
const CACHE_ENABLED = !["0", "false", "no"].includes(
  String(process.env.NOTION_SYNC_CACHE || "1").trim().toLowerCase(),
);
const CACHE_FORCE = ["1", "true", "yes"].includes(
  String(process.env.NOTION_SYNC_FORCE || "").trim().toLowerCase(),
);

const DEFAULT_CONFIG = DEFAULT_SITE_CONFIG;
const ASSET_FORCE = process.env.NOTION_SYNC_FORCE === "1" || process.env.NOTION_SYNC_FORCE === "true";

const buildPageTree = createPageTreeBuilder({
  cacheDir: CACHE_DIR,
  cacheEnabled: CACHE_ENABLED,
  cacheForce: CACHE_FORCE,
});

const downloadAsset = createAssetDownloader({
  outPublicAssetsDir: OUT_PUBLIC_ASSETS_DIR,
  force: ASSET_FORCE,
});

function renderKatex(expression, { displayMode }) {
  const expr = String(expression ?? "").trim();
  if (!expr) return "";
  try {
    return katex.renderToString(expr, {
      displayMode: Boolean(displayMode),
      throwOnError: false,
      strict: "ignore",
    });
  } catch {
    return escapeHtml(expr);
  }
}

async function main() {
  const adminPageId = compactId(process.env.NOTION_SITE_ADMIN_PAGE_ID);
  if (!adminPageId) {
    throw new Error(
      "Missing NOTION_SITE_ADMIN_PAGE_ID (expected a Notion page id or URL)",
    );
  }

  const dbCfg = await loadConfigFromAdminDatabases(adminPageId);
  const configBlock = dbCfg ? null : await findFirstJsonCodeBlock(adminPageId);
  const parsed = configBlock?.json ? JSON.parse(configBlock.json) : {};
  const cfg = deepMerge(DEFAULT_CONFIG, dbCfg || parsed);

  const rootPageId = compactId(cfg?.content?.rootPageId) || adminPageId;
  const configuredHomePageId = compactId(cfg?.content?.homePageId);
  const homePageId = configuredHomePageId || rootPageId;
  const routeOverrides = new Map();
  if (isObject(cfg?.content?.routeOverrides)) {
    for (const [k, v] of Object.entries(cfg.content.routeOverrides)) {
      const id = compactId(k);
      const route = normalizeRoutePath(v);
      if (!id || !route) continue;
      routeOverrides.set(id, route);
    }
  }

  // Optional explicit includes (Site Admin -> Included Pages).
  const includedPages = await loadIncludedPagesFromAdminDatabases(adminPageId);
  for (const it of includedPages) {
    if (it?.pageId && it?.routePath) {
      // Explicit route path should win over other mappings.
      routeOverrides.set(it.pageId, it.routePath);
    }
  }

  console.log(`[sync:notion] Admin page: ${adminPageId}`);
  console.log(`[sync:notion] Content root: ${rootPageId}`);
  console.log(`[sync:notion] Output: ${path.relative(ROOT, OUT_DIR)}`);

  // Fresh build output (do not touch `content/raw`).
  rmDir(OUT_RAW_DIR);
  ensureDir(OUT_RAW_DIR);

  // Routing model:
  // - If homePageId === rootPageId, we include the root page itself at `/`.
  //   Its child pages become `/child`, `/child/grandchild`, etc.
  // - Otherwise (root is a container), we render only child pages, using the
  //   classic "one of the top-level children becomes `/`" mapping.
  let allPages = [];
  let routeByPageId = new Map();
  const routeToPageId = new Map();

  if (homePageId === rootPageId) {
    const rootTitle = await getPageTitle(rootPageId);
    const seenDatabases = new Set();
    const rootNode = {
      kind: "page",
      id: rootPageId,
      title: rootTitle,
      children: await buildPageTree(rootPageId, { seenDatabases }),
      parentId: "",
      routePath: "/",
      routeSegments: [],
    };

    // Merge explicitly included pages as additional root children.
    if (includedPages.length) {
      const existing = new Set(flattenPages(rootNode.children).map((n) => n.id));
      for (const it of includedPages) {
        if (!it?.pageId || existing.has(it.pageId) || it.pageId === rootPageId) continue;
        const t = await getPageTitle(it.pageId);
        const node = {
          kind: "page",
          id: it.pageId,
          title: t,
          children: await buildPageTree(it.pageId, { seenDatabases }),
          parentId: rootPageId,
          routePath: "",
          routeSegments: [],
        };
        rootNode.children.push(node);
        existing.add(it.pageId);
      }
    }

    assignRoutes(rootNode.children, { homePageId, routeOverrides });

    const descendants = flattenPages(rootNode.children);
    allPages = [rootNode, ...descendants];
    for (const p of allPages) {
      if (routeToPageId.has(p.routePath)) {
        throw new Error(
          `Duplicate route '${p.routePath}' for pages ${routeToPageId.get(
            p.routePath,
          )} and ${p.id}. Add content.routeOverrides to resolve.`,
        );
      }
      routeToPageId.set(p.routePath, p.id);
      routeByPageId.set(p.id, p.routePath);
    }
  } else {
    const seenDatabases = new Set();
    const top = await buildPageTree(rootPageId, { seenDatabases });
    if (!top.length) {
      throw new Error(
        "No child pages found under the configured content root page. Create child pages under the root page (or set content.rootPageId).",
      );
    }

    // Merge explicitly included pages as additional top-level nodes.
    if (includedPages.length) {
      const existing = new Set(flattenPages(top).map((n) => n.id));
      for (const it of includedPages) {
        if (!it?.pageId || existing.has(it.pageId) || it.pageId === rootPageId) continue;
        const t = await getPageTitle(it.pageId);
        top.push({
          kind: "page",
          id: it.pageId,
          title: t,
          children: await buildPageTree(it.pageId, { seenDatabases }),
          parentId: rootPageId,
          routePath: "",
          routeSegments: [],
        });
        existing.add(it.pageId);
      }
    }

    const topHomePageId = pickHomePageId(top, cfg);
    assignRoutes(top, { homePageId: topHomePageId, routeOverrides });
    allPages = flattenPages(top);
    for (const p of allPages) {
      if (routeToPageId.has(p.routePath)) {
        throw new Error(
          `Duplicate route '${p.routePath}' for pages ${routeToPageId.get(
            p.routePath,
          )} and ${p.id}. Add content.routeOverrides to resolve.`,
        );
      }
      routeToPageId.set(p.routePath, p.id);
      routeByPageId.set(p.id, p.routePath);
    }
  }

  // Build lookup tables (used for page mentions and child_page blocks).
  const pageByRoute = new Map();
  for (const p of allPages) {
    pageByRoute.set(p.routePath, p);
  }

  // Parent route for styling/breadcrumbs.
  for (const p of allPages) {
    const parentRoute = routeByPageId.get(p.parentId) || "/";
    p.parentRoutePath = parentRoute;
  }

  // Write site-config for Next.js runtime to consume.
  const siteConfigOutPath = path.join(OUT_DIR, "site-config.json");
  writeFile(siteConfigOutPath, JSON.stringify(cfg, null, 2) + "\n");

  // Access control config (optional).
  const protectedRoutes = await loadProtectedRoutesFromAdminDatabases(adminPageId, { routeToPageId });
  writeFile(
    path.join(OUT_DIR, "protected-routes.json"),
    JSON.stringify(protectedRoutes, null, 2) + "\n",
  );

  // Emit a small, human/debug-friendly sync metadata file so /site-admin can
  // verify that deploys are actually picking up the latest Notion state.
  const homeRouteNode = allPages.find((p) => p?.routePath === "/") || null;
  const syncMeta = {
    syncedAt: new Date().toISOString(),
    notionVersion: NOTION_VERSION,
    adminPageId,
    rootPageId,
    homePageId: homeRouteNode?.id || "",
    homeTitle: homeRouteNode?.title || "",
    pages: allPages.length,
    routes: routeToPageId.size,
    routeOverrides: routeOverrides.size,
    protectedRules: protectedRoutes.length,
    searchIndexMaxChars: 8000,
  };
  writeFile(path.join(OUT_DIR, "sync-meta.json"), JSON.stringify(syncMeta, null, 2) + "\n");

  // Sync pages.
  console.log(`[sync:notion] Pages: ${allPages.length}`);
  const dbById = new Map(allPages.filter((p) => p.kind === "database").map((p) => [p.id, p]));
  const nodeById = new Map(allPages.map((p) => [p.id, p]));
  const homePage = allPages.find((p) => p.routePath === "/") || null;
  const homeTitle = homePage?.title || "Home";
  const homeRoutePageId = homePage?.id || "";
  const ctx = {
    routeByPageId,
    dbById,
    nodeById,
    homeTitle,
    homePageId: homeRoutePageId,
    // Shared renderer helpers (kept here to centralize side effects).
    downloadAsset,
    renderKatex,
  };

  const searchIndex = await renderPagesAndBuildSearchIndex({
    allPages,
    cfg,
    ctx,
    outRawDir: OUT_RAW_DIR,
    cacheDir: CACHE_DIR,
    cacheEnabled: CACHE_ENABLED,
    cacheForce: CACHE_FORCE,
    searchMaxChars: 8_000,
    log: console.log,
  });

  writeSyncArtifacts({
    outDir: OUT_DIR,
    allPages,
    cfg,
    routeOverrides,
    searchIndex,
  });

  console.log("[sync:notion] Done.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
