/* Sync content from Notion into `content/generated/` so the site can be deployed
 * without Super.so.
 *
 * High-level:
 * - A Notion "Site Admin" page stores site config (JSON code block).
 * - The admin page's child pages (recursive) are compiled into `content/generated/raw/<route>.html`.
 * - A simple deploy button in Notion can trigger a Vercel deploy hook (see /api/deploy).
 *
 * Required env:
 * - NOTION_TOKEN: Notion internal integration token
 * - NOTION_SITE_ADMIN_PAGE_ID: Notion page id (or URL) for the admin page
 *
 * Optional:
 * - NOTION_VERSION: Notion API version (default: 2022-06-28)
 * - NOTION_SYNC_FORCE=1: re-download assets even if they exist
 */

import fs from "node:fs";
import path from "node:path";
import katex from "katex";

import { DEFAULT_SITE_CONFIG } from "../lib/shared/default-site-config.mjs";
import { deepMerge, isObject } from "../lib/shared/object-utils.mjs";
import {
  notionRequest,
  queryDatabase,
  findFirstJsonCodeBlock,
  getDatabaseInfo,
  getDatabaseParentPageId,
  hydrateBlocks,
  listBlockChildrenCached,
} from "../lib/notion/index.mjs";
import { compactId, normalizeRoutePath } from "../lib/shared/route-utils.mjs";
import { escapeHtml } from "../lib/shared/text-utils.mjs";
import { ensureDir, readJsonFile, rmDir, writeFile, writeJsonAtomic } from "./notion-sync/fs-utils.mjs";
import {
  loadConfigFromAdminDatabases,
  loadIncludedPagesFromAdminDatabases,
  loadProtectedRoutesFromAdminDatabases,
} from "./notion-sync/site-admin-dbs.mjs";
import {
  assignRoutes,
  flattenPages,
  pickHomePageId,
  routePathToHtmlRel,
} from "./notion-sync/route-model.mjs";
import {
  buildSearchIndexFieldsFromBlocks,
} from "./notion-sync/search-text.mjs";
import { renderDatabaseMain, renderPageMain, richTextPlain } from "./notion-sync/render-page.mjs";

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

function cacheFile(kind, id) {
  const safeKind = String(kind || "misc").replace(/[^a-z0-9_-]/gi, "_");
  const safeId = String(id || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return path.join(CACHE_DIR, safeKind, `${safeId}.json`);
}

function stripTreeForCache(value) {
  // Drop heavy Notion API objects that we don't need for routing/tree reuse.
  // Rendering uses a separate cache (page-render) keyed by last_edited_time.
  return JSON.parse(
    JSON.stringify(value, (k, v) => {
      if (k === "__page") return undefined;
      return v;
    }),
  );
}

function normalizeHref(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";

  // Keep absolute/external links intact.
  if (/^(https?:\/\/|mailto:|tel:|#)/i.test(raw)) return raw;

  // Treat everything else as an internal route.
  return normalizeRoutePath(raw);
}

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

async function getPageInfo(pageId) {
  const pid = compactId(pageId);
  if (!pid) return { id: "", title: "Untitled", lastEdited: "" };
  const data = await notionRequest(`pages/${pid}`);
  const lastEdited = String(data?.last_edited_time || "").trim();
  const props = data?.properties && typeof data.properties === "object" ? data.properties : {};
  for (const v of Object.values(props)) {
    if (v && typeof v === "object" && v.type === "title") {
      const title = richTextPlain(v.title ?? []) || "Untitled";
      return { id: pid, title, lastEdited };
    }
  }
  return { id: pid, title: "Untitled", lastEdited };
}

async function getPageTitle(pageId) {
  const info = await getPageInfo(pageId);
  return info.title || "Untitled";
}

function getTitleFromPageObject(page) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  for (const v of Object.values(props)) {
    if (v && typeof v === "object" && v.type === "title") {
      const t = richTextPlain(v.title ?? []).trim();
      if (t) return t;
    }
  }
  return "Untitled";
}

function toDateIso(start) {
  const s = String(start || "").trim();
  if (!s) return null;
  // Prefer YYYY-MM-DD if the value is ISO datetime.
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function formatDateLong(start) {
  const iso = toDateIso(start);
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function extractFirstDateProperty(page) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  for (const [name, v] of Object.entries(props)) {
    if (!v || typeof v !== "object") continue;
    if (v.type !== "date") continue;
    const start = v.date?.start;
    const iso = toDateIso(start);
    const text = formatDateLong(start);
    if (!iso || !text) continue;
    return { name, id: String(v.id || ""), iso, text };
  }
  return null;
}

async function buildPageTree(
  parentPageId,
  {
    seenDatabases,
  } = {},
) {
  const seenDb = seenDatabases || new Set();

  const pid = compactId(parentPageId);
  let pageLastEdited = "";
  if (CACHE_ENABLED && !CACHE_FORCE && pid) {
    try {
      const info = await getPageInfo(pid);
      const lastEdited = info.lastEdited || "";
      pageLastEdited = lastEdited;
      if (lastEdited) {
        const file = cacheFile("page-tree", pid);
        const cached = readJsonFile(file);
        const cachedEdited = cached?.lastEdited ? String(cached.lastEdited) : "";
        if (cached && cachedEdited && cachedEdited === lastEdited && Array.isArray(cached.children)) {
          // Ensure any databases in the cached subtree are marked as seen, otherwise later
          // traversals could re-include them.
          const stack = [...cached.children];
          while (stack.length) {
            const n = stack.pop();
            if (!n || typeof n !== "object") continue;
            if (n.kind === "database" && n.id) seenDb.add(String(n.id));
            if (Array.isArray(n.children)) stack.push(...n.children);
          }
          return cached.children;
        }
      }
    } catch {
      // ignore cache failures
    }
  }
  // Scan recursively so we discover child pages/databases nested inside toggles/columns/callouts/etc.
  const blocks = await (async () => {
    const top = await listBlockChildrenCached(parentPageId);
    const stack = [...top].reverse();
    const out = [];
    const seen = new Set(); // block id

    while (stack.length) {
      const b = stack.pop();
      if (!b || !b.id) continue;
      const bid = compactId(b.id);
      if (bid && seen.has(bid)) continue;
      if (bid) seen.add(bid);

      out.push(b);

      // IMPORTANT: don't expand child_page/child_database here. We treat them as
      // nodes and recurse using their canonical ids, otherwise we "inline" the
      // subtree at the wrong parent and duplicate routes.
      const t = String(b?.type || "");
      if (b?.has_children && t !== "child_page" && t !== "child_database") {
        const kids = await listBlockChildrenCached(b.id);
        // Preserve Notion order: parent, then its children, then next sibling.
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }

    return out;
  })();

  const out = [];

  for (const b of blocks) {
    if (b?.type === "child_page" && b?.child_page?.title) {
      const node = {
        kind: "page",
        id: compactId(b.id),
        title: b.child_page.title,
        children: [],
        parentId: compactId(parentPageId),
        routePath: "",
        routeSegments: [],
      };
      node.children = await buildPageTree(node.id, { seenDatabases: seenDb });
      out.push(node);
      continue;
    }

    if (b?.type === "child_database") {
      const dbId = compactId(b.id);
      const title = String(b.child_database?.title ?? "").trim() || "Database";

      // If this database's canonical parent is another page, this is a linked view.
      // Skip it to avoid duplicating routes (Super-like behavior).
      if (dbId) {
        const canonicalParent = await getDatabaseParentPageId(dbId);
        if (canonicalParent && canonicalParent !== compactId(parentPageId)) {
          continue;
        }
        if (seenDb.has(dbId)) continue;
        seenDb.add(dbId);
      }

      // Database caching: databases can change (rows added/edited) without the parent page changing.
      // Cache the rendered tree for the database keyed by Notion database `last_edited_time`.
      let dbLastEdited = "";
      if (CACHE_ENABLED && !CACHE_FORCE && dbId) {
        try {
          const info = await getDatabaseInfo(dbId);
          dbLastEdited = info.lastEdited || "";
          if (dbLastEdited) {
            const file = cacheFile("db-tree", dbId);
            const cached = readJsonFile(file);
            const cachedEdited = cached?.lastEdited ? String(cached.lastEdited) : "";
            if (cached && cachedEdited && cachedEdited === dbLastEdited && cached.node) {
              const node = cached.node;
              // Ensure parent pointers are consistent (defensive).
              node.parentId = compactId(parentPageId);
              out.push(node);
              continue;
            }
          }
        } catch {
          // ignore db cache failures
        }
      }

      const rows = await queryDatabase(dbId);
      const items = rows
        .filter((p) => !p?.archived && !p?.in_trash)
        .map((p) => {
          const date = extractFirstDateProperty(p);
          return {
            kind: "page",
            id: compactId(p.id),
            title: getTitleFromPageObject(p),
            children: [],
            parentId: dbId,
            routePath: "",
            routeSegments: [],
            __page: p,
            __date: date,
          };
        });

      // Match Super's "newest first" behavior when a Date property exists.
      items.sort((a, b) => {
        const ai = a.__date?.iso || "";
        const bi = b.__date?.iso || "";
        if (ai && bi) return ai < bi ? 1 : ai > bi ? -1 : 0;
        if (ai && !bi) return -1;
        if (!ai && bi) return 1;
        return a.title.localeCompare(b.title);
      });

      for (const it of items) {
        it.children = await buildPageTree(it.id, { seenDatabases: seenDb });
      }

      const dbNode = {
        kind: "database",
        id: dbId,
        title,
        children: items,
        parentId: compactId(parentPageId),
        routePath: "",
        routeSegments: [],
      };
      out.push(dbNode);

      if (CACHE_ENABLED && !CACHE_FORCE && dbId) {
        try {
          if (!dbLastEdited) dbLastEdited = (await getDatabaseInfo(dbId)).lastEdited || "";
          if (dbLastEdited) {
            writeJsonAtomic(cacheFile("db-tree", dbId), {
              lastEdited: dbLastEdited,
              node: stripTreeForCache(dbNode),
            });
          }
        } catch {
          // ignore cache write failures
        }
      }
    }
  }

  if (CACHE_ENABLED && !CACHE_FORCE && pid) {
    try {
      let lastEdited = pageLastEdited;
      if (!lastEdited) lastEdited = (await getPageInfo(pid)).lastEdited || "";
      if (lastEdited) {
        writeJsonAtomic(cacheFile("page-tree", pid), {
          lastEdited,
          children: stripTreeForCache(out),
        });
      }
    } catch {
      // ignore cache write errors
    }
  }

  return out;
}

async function downloadAsset(url, stableName) {
  const force = process.env.NOTION_SYNC_FORCE === "1" || process.env.NOTION_SYNC_FORCE === "true";
  const u = new URL(url);
  const pathname = u.pathname || "";
  const extMatch = pathname.match(/\.([a-z0-9]{1,5})$/i);
  const ext = (extMatch?.[1] || "bin").toLowerCase();
  const fileName = `${stableName}.${ext}`;
  const filePath = path.join(OUT_PUBLIC_ASSETS_DIR, fileName);
  const publicPath = `/notion-assets/${fileName}`;

  if (!force) {
    try {
      if (fs.statSync(filePath).isFile()) return publicPath;
    } catch {
      // continue
    }
  }

  ensureDir(OUT_PUBLIC_ASSETS_DIR);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Asset download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
  return publicPath;
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

  const searchIndex = [];
  const SEARCH_MAX_CHARS = 8_000;
  for (const p of allPages) {
    const mainHtml = await (p.kind === "database"
      ? (async () => {
          const childTitles = (p.children || [])
            .filter((x) => x && x.kind !== "database")
            .map((x) => String(x.title || "").trim())
            .filter(Boolean)
            .join("\n");
          const dbTextRaw = `${p.title}\n${childTitles}`.trim();
          const dbText = dbTextRaw.length > SEARCH_MAX_CHARS ? dbTextRaw.slice(0, SEARCH_MAX_CHARS).trim() : dbTextRaw;
          searchIndex.push({
            id: p.id,
            title: p.title,
            kind: p.kind,
            routePath: p.routePath,
            text: dbText,
          });
          return renderDatabaseMain(p, cfg, ctx);
        })()
      : (async () => {
          let lastEdited = "";
          try {
            if (p.__page?.last_edited_time) lastEdited = String(p.__page.last_edited_time || "").trim();
          } catch {
            // ignore
          }
          if (!lastEdited) {
            // Fetch page metadata (cheap) so we can validate the build cache.
            try {
              lastEdited = (await getPageInfo(p.id)).lastEdited || "";
            } catch {
              // ignore
            }
          }

          const cachePath = cacheFile("page-render", p.id);
          if (CACHE_ENABLED && !CACHE_FORCE && lastEdited) {
            const cached = readJsonFile(cachePath);
            const cachedEdited = cached?.lastEdited ? String(cached.lastEdited) : "";
            if (cached && cachedEdited === lastEdited && typeof cached.html === "string") {
              const text = String(cached.text || "").trim();
              searchIndex.push({
                id: p.id,
                title: p.title,
                kind: p.kind,
                routePath: p.routePath,
                headings: Array.isArray(cached.headings) ? cached.headings : [],
                text,
              });
              return String(cached.html);
            }
          }

          const blocks = await hydrateBlocks(await listBlockChildrenCached(p.id));
          const fields = buildSearchIndexFieldsFromBlocks(blocks);
          searchIndex.push({
            id: p.id,
            title: p.title,
            kind: p.kind,
            routePath: p.routePath,
            headings: fields.headings,
            text: fields.text,
          });
          const html = await renderPageMain(p, blocks, cfg, ctx);

          if (CACHE_ENABLED && !CACHE_FORCE && lastEdited) {
            try {
              writeJsonAtomic(cachePath, { lastEdited, html, text: fields.text, headings: fields.headings });
            } catch {
              // ignore cache write failures
            }
          }

          return html;
        })());
    const rel = routePathToHtmlRel(p.routePath);
    const outPath = path.join(OUT_RAW_DIR, rel);
    writeFile(outPath, mainHtml + "\n");
    console.log(`[sync:notion] Wrote ${rel}`);
  }

  writeFile(
    path.join(OUT_DIR, "search-index.json"),
    // Keep it compact; this file is parsed on demand by /api/search.
    JSON.stringify(searchIndex) + "\n",
  );

  // Small debug artifact: route map.
  const routes = Object.fromEntries(allPages.map((p) => [p.routePath, p.id]));
  writeFile(path.join(OUT_DIR, "routes.json"), JSON.stringify(routes, null, 2) + "\n");

  // Route explorer manifest (used by /__routes).
  const navHrefToGroup = new Map();
  for (const it of cfg?.nav?.top || []) navHrefToGroup.set(normalizeHref(it.href), "top");
  for (const it of cfg?.nav?.more || []) navHrefToGroup.set(normalizeHref(it.href), "more");

  const routeManifest = allPages.map((p) => {
    const navGroup = navHrefToGroup.get(p.routePath) || "";
    const overridden = routeOverrides.has(p.id);
    return {
      id: p.id,
      title: p.title,
      kind: p.kind,
      routePath: p.routePath,
      parentId: p.parentId,
      parentRoutePath: p.parentRoutePath || "/",
      navGroup,
      overridden,
    };
  });

  writeFile(
    path.join(OUT_DIR, "routes-manifest.json"),
    JSON.stringify(routeManifest, null, 2) + "\n",
  );

  console.log("[sync:notion] Done.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
