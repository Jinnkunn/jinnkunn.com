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
} from "../lib/notion/api.mjs";
import { compactId, normalizeRoutePath, slugify } from "../lib/shared/route-utils.mjs";
import { escapeHtml } from "../lib/shared/text-utils.mjs";
import {
  findFirstJsonCodeBlock,
  getDatabaseInfo,
  getDatabaseParentPageId,
  hydrateBlocks,
  listBlockChildrenCached,
} from "../lib/notion/tree.mjs";
import { ensureDir, readJsonFile, rmDir, writeFile, writeJsonAtomic } from "./notion-sync/fs-utils.mjs";
import {
  loadConfigFromAdminDatabases,
  loadIncludedPagesFromAdminDatabases,
  loadProtectedRoutesFromAdminDatabases,
} from "./notion-sync/site-admin-dbs.mjs";
import {
  assignRoutes,
  canonicalizePublicHref,
  flattenPages,
  pickHomePageId,
  routePathToHtmlRel,
} from "./notion-sync/route-model.mjs";
import {
  buildSearchIndexFieldsFromBlocks,
} from "./notion-sync/search-text.mjs";
import { renderBreadcrumbs } from "./notion-sync/breadcrumbs.mjs";

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

function pickCalloutBgClass(color) {
  const c = String(color || "default").replace(/_background$/, "");
  if (c === "default") return "bg-gray-light";
  return `bg-${c}-light`;
}

function pageIconSvg() {
  // Matches the common "page" icon used by Super.
  return `<svg class="notion-icon notion-icon__page" viewBox="0 0 16 16" width="18" height="18" style="width: 18px; height: 18px; font-size: 18px; fill: var(--color-text-default-light);"><path d="M4.35645 15.4678H11.6367C13.0996 15.4678 13.8584 14.6953 13.8584 13.2256V7.02539C13.8584 6.0752 13.7354 5.6377 13.1406 5.03613L9.55176 1.38574C8.97754 0.804688 8.50586 0.667969 7.65137 0.667969H4.35645C2.89355 0.667969 2.13477 1.44043 2.13477 2.91016V13.2256C2.13477 14.7021 2.89355 15.4678 4.35645 15.4678ZM4.46582 14.1279C3.80273 14.1279 3.47461 13.7793 3.47461 13.1436V2.99219C3.47461 2.36328 3.80273 2.00781 4.46582 2.00781H7.37793V5.75391C7.37793 6.73145 7.86328 7.20312 8.83398 7.20312H12.5186V13.1436C12.5186 13.7793 12.1836 14.1279 11.5205 14.1279H4.46582ZM8.95703 6.02734C8.67676 6.02734 8.56055 5.9043 8.56055 5.62402V2.19238L12.334 6.02734H8.95703ZM10.4336 9.00098H5.42969C5.16992 9.00098 4.98535 9.19238 4.98535 9.43164C4.98535 9.67773 5.16992 9.86914 5.42969 9.86914H10.4336C10.6797 9.86914 10.8643 9.67773 10.8643 9.43164C10.8643 9.19238 10.6797 9.00098 10.4336 9.00098ZM10.4336 11.2979H5.42969C5.16992 11.2979 4.98535 11.4893 4.98535 11.7354C4.98535 11.9746 5.16992 12.1592 5.42969 12.1592H10.4336C10.6797 12.1592 10.8643 11.9746 10.8643 11.7354C10.8643 11.4893 10.6797 11.2979 10.4336 11.2979Z"></path></svg>`;
}

function calendarIconSvg16() {
  // Matches the icon used in Super's page properties ("Date").
  return `<svg viewBox="0 0 16 16" style="width:16px;height:16px"><path d="M3.29688 14.4561H12.7031C14.1797 14.4561 14.9453 13.6904 14.9453 12.2344V3.91504C14.9453 2.45215 14.1797 1.69336 12.7031 1.69336H3.29688C1.82031 1.69336 1.05469 2.45215 1.05469 3.91504V12.2344C1.05469 13.6973 1.82031 14.4561 3.29688 14.4561ZM3.27637 13.1162C2.70898 13.1162 2.39453 12.8154 2.39453 12.2207V5.9043C2.39453 5.30273 2.70898 5.00879 3.27637 5.00879H12.71C13.2842 5.00879 13.6055 5.30273 13.6055 5.9043V12.2207C13.6055 12.8154 13.2842 13.1162 12.71 13.1162H3.27637ZM6.68066 7.38086H7.08398C7.33008 7.38086 7.41211 7.30566 7.41211 7.05957V6.66309C7.41211 6.41699 7.33008 6.3418 7.08398 6.3418H6.68066C6.44141 6.3418 6.35938 6.41699 6.35938 6.66309V7.05957C6.35938 7.30566 6.44141 7.38086 6.68066 7.38086ZM8.92285 7.38086H9.31934C9.56543 7.38086 9.64746 7.30566 9.64746 7.05957V6.66309C9.64746 6.41699 9.56543 6.3418 9.31934 6.3418H8.92285C8.67676 6.3418 8.59473 6.41699 8.59473 6.66309V7.05957C8.59473 7.30566 8.67676 7.38086 8.92285 7.38086ZM11.1582 7.38086H11.5547C11.8008 7.38086 11.8828 7.30566 11.8828 7.05957V6.66309C11.8828 6.41699 11.8008 6.3418 11.5547 6.3418H11.1582C10.9121 6.3418 10.8301 6.41699 10.8301 6.66309V7.05957C10.8301 7.30566 10.9121 7.38086 11.1582 7.38086ZM4.44531 9.58203H4.84863C5.09473 9.58203 5.17676 9.50684 5.17676 9.26074V8.86426C5.17676 8.61816 5.09473 8.54297 4.84863 8.54297H4.44531C4.20605 8.54297 4.12402 8.61816 4.12402 8.86426V9.26074C4.12402 9.50684 4.20605 9.58203 4.44531 9.58203ZM6.68066 9.58203H7.08398C7.33008 9.58203 7.41211 9.50684 7.41211 9.26074V8.86426C7.41211 8.61816 7.33008 8.54297 7.08398 8.54297H6.68066C6.44141 8.54297 6.35938 8.61816 6.35938 8.86426V9.26074C6.35938 9.50684 6.44141 9.58203 6.68066 9.58203ZM8.92285 9.58203H9.31934C9.56543 9.58203 9.64746 9.50684 9.64746 9.26074V8.86426C9.64746 8.61816 9.56543 8.54297 9.31934 8.54297H8.92285C8.67676 8.54297 8.59473 8.61816 8.59473 8.86426V9.26074C8.59473 9.50684 8.67676 9.58203 8.92285 9.58203ZM11.1582 9.58203H11.5547C11.8008 9.58203 11.8828 9.50684 11.8828 9.26074V8.86426C11.8828 8.61816 11.8008 8.54297 11.5547 8.54297H11.1582C10.9121 8.54297 10.8301 8.61816 10.8301 8.86426V9.26074C10.8301 9.50684 10.9121 9.58203 11.1582 9.58203ZM4.44531 11.7832H4.84863C5.09473 11.7832 5.17676 11.708 5.17676 11.4619V11.0654C5.17676 10.8193 5.09473 10.7441 4.84863 10.7441H4.44531C4.20605 10.7441 4.12402 10.8193 4.12402 11.0654V11.4619C4.12402 11.708 4.20605 11.7832 4.44531 11.7832ZM6.68066 11.7832H7.08398C7.33008 11.7832 7.41211 11.708 7.41211 11.4619V11.0654C7.41211 10.8193 7.33008 10.7441 7.08398 10.7441H6.68066C6.44141 10.7441 6.35938 10.8193 6.35938 11.0654V11.4619C6.35938 11.708 6.44141 11.7832 6.68066 11.7832ZM8.92285 11.7832H9.31934C9.56543 11.7832 9.64746 11.708 9.64746 11.4619V11.0654C9.64746 10.8193 9.56543 10.7441 9.31934 10.7441H8.92285C8.67676 10.7441 8.59473 10.8193 8.59473 11.0654V11.4619C8.59473 11.708 8.67676 11.7832 8.92285 11.7832Z"></path></svg>`;
}

function personIconSvg16() {
  // Matches the icon used in Super's page properties ("Person").
  return `<svg viewBox="0 0 16 16" style="width:16px;height:16px"><path d="M10.9536 7.90088C12.217 7.90088 13.2559 6.79468 13.2559 5.38525C13.2559 4.01514 12.2114 2.92017 10.9536 2.92017C9.70142 2.92017 8.65137 4.02637 8.65698 5.39087C8.6626 6.79468 9.69019 7.90088 10.9536 7.90088ZM4.4231 8.03003C5.52368 8.03003 6.42212 7.05859 6.42212 5.83447C6.42212 4.63843 5.51245 3.68945 4.4231 3.68945C3.33374 3.68945 2.41846 4.64966 2.41846 5.84009C2.42407 7.05859 3.32251 8.03003 4.4231 8.03003ZM1.37964 13.168H5.49561C4.87231 12.292 5.43384 10.6074 6.78711 9.51807C6.18628 9.14746 5.37769 8.87231 4.4231 8.87231C1.95239 8.87231 0.262207 10.6917 0.262207 12.1628C0.262207 12.7974 0.548584 13.168 1.37964 13.168ZM7.50024 13.168H14.407C15.4009 13.168 15.7322 12.8423 15.7322 12.2864C15.7322 10.8489 13.8679 8.88354 10.9536 8.88354C8.04492 8.88354 6.17505 10.8489 6.17505 12.2864C6.17505 12.8423 6.50635 13.168 7.50024 13.168Z"></path></svg>`;
}

function extractFirstPeopleProperty(page) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  for (const [name, v] of Object.entries(props)) {
    if (!v || typeof v !== "object") continue;
    if (v.type !== "people") continue;
    const people = Array.isArray(v.people) ? v.people : [];
    const names = people.map((p) => String(p?.name || "").trim()).filter(Boolean);
    if (!names.length) continue;
    return { name, id: String(v.id || ""), names };
  }
  return null;
}

function renderPagePropertiesFromPageObject(pageObj) {
  const date = extractFirstDateProperty(pageObj);
  const people = extractFirstPeopleProperty(pageObj);

  const props = [];

  if (date) {
    const propId = date.id ? String(date.id).replace(/[^a-z0-9]/gi, "") : "";
    const dateClass = propId ? ` property-${escapeHtml(propId)}` : "";
    props.push(
      `<div class="notion-page__property"><div class="notion-page__property-name-wrapper"><div class="notion-page__property-icon-wrapper">${calendarIconSvg16()}</div><div class="notion-page__property-name"><span>${escapeHtml(
        date.name,
      )}</span></div></div><div class="notion-property notion-property__date${dateClass} notion-semantic-string"><span class="date">${escapeHtml(
        date.text,
      )}</span></div></div>`,
    );
  }

  if (people) {
    const propId = people.id ? String(people.id).replace(/[^a-z0-9]/gi, "") : "";
    const personClass = propId ? ` property-${escapeHtml(propId)}` : "";
    const primary = people.names[0] || "Person";
    const avatarLetter = escapeHtml(primary.trim().slice(0, 1).toUpperCase() || "P");
    props.push(
      `<div class="notion-page__property"><div class="notion-page__property-name-wrapper"><div class="notion-page__property-icon-wrapper">${personIconSvg16()}</div><div class="notion-page__property-name"><span>${escapeHtml(
        people.name,
      )}</span></div></div><div class="notion-property notion-property__person${personClass} notion-semantic-string no-wrap"><span class="individual-with-image"><div class="individual-letter-avatar">${avatarLetter}</div><span>${escapeHtml(
        primary,
      )}</span></span></div></div>`,
    );
  }

  if (!props.length) return "";
  return `<div class="notion-page__properties">${props.join("")}<div id="block-root-divider" class="notion-divider"></div></div>`;
}

function embedSpinnerSvg() {
  // Matches the inline SVG loader used by Super embeds.
  return `<svg class="super-loader__spinner" viewBox="0 0 24 24"><defs><linearGradient x1="28.1542969%" y1="63.7402344%" x2="74.6289062%" y2="17.7832031%" id="linearGradient-1"><stop stop-color="rgba(164, 164, 164, 1)" offset="0%"></stop><stop stop-color="rgba(164, 164, 164, 0)" stop-opacity="0" offset="100%"></stop></linearGradient></defs><g id="Page-1" stroke="none" stroke-width="1" fill="none"><g transform="translate(-236.000000, -286.000000)"><g transform="translate(238.000000, 286.000000)"><circle id="Oval-2" stroke="url(#linearGradient-1)" stroke-width="4" cx="10" cy="12" r="10"></circle><path d="M10,2 C4.4771525,2 0,6.4771525 0,12" id="Oval-2" stroke="rgba(164, 164, 164, 1)" stroke-width="4"></path><rect id="Rectangle-1" fill="rgba(164, 164, 164, 1)" x="8" y="0" width="4" height="4" rx="8"></rect></g></g></g></g></svg>`;
}

function richTextPlain(richText) {
  return (richText || []).map((x) => x?.plain_text ?? "").join("");
}

function renderRichText(richText, ctx) {
  const items = Array.isArray(richText) ? richText : [];
  return items.map((rt) => renderRichTextItem(rt, ctx)).join("");
}

function rewriteHref(rawHref, ctx) {
  const href = String(rawHref ?? "").trim();
  if (!href) return "";

  const routeByPageId = ctx?.routeByPageId;

  let url;
  let isAbsolute = false;
  try {
    url = new URL(href);
    isAbsolute = true;
  } catch {
    try {
      // Parse relative URLs consistently.
      url = new URL(href, "https://local.invalid");
    } catch {
      return href;
    }
  }

  const host = String(url.host || "").toLowerCase();

  // If this is a Notion page URL (or a super-exported "/<pageId>" path), map it
  // to the discovered route so internal links don't break.
  const compact = compactId(href);
  if (compact && routeByPageId?.has?.(compact)) {
    const mapped = routeByPageId.get(compact);
    if (mapped) return mapped;
  }

  // Rewrite absolute links to the production domain back into relative paths so
  // the clone site stays self-contained across deployments/domains.
  const isProdDomain =
    host === "jinkunchen.com" ||
    host === "www.jinkunchen.com" ||
    host === "jinnkunn.com" ||
    host === "www.jinnkunn.com";
  if (isAbsolute && isProdDomain) {
    return `${url.pathname || "/"}${url.search || ""}${url.hash || ""}`;
  }

  return href;
}

function renderRichTextItem(rt, ctx) {
  const annotations = rt?.annotations ?? {};
  const color = String(annotations.color || "default");
  const href = rewriteHref(
    rt?.href ||
      rt?.text?.link?.url ||
      (rt?.type === "mention" && rt?.mention?.type === "page"
        ? ctx.routeByPageId.get(compactId(rt?.mention?.page?.id)) || ""
        : ""),
    ctx,
  );

  let inner = "";
  if (rt?.type === "equation") {
    const expr = rt?.equation?.expression ?? rt?.plain_text ?? "";
    inner = `<span class="notion-equation notion-equation__inline">${renderKatex(
      expr,
      { displayMode: false },
    )}</span>`;
  } else {
    inner = escapeHtml(rt?.plain_text ?? "");
  }

  // Super/Notion export wraps anchors *inside* typography wrappers.
  // We mirror that order to ensure the upstream CSS selectors match 1:1.
  if (href) {
    const external = /^https?:\/\//i.test(href);
    const attrs = external
      ? ` target="_blank" rel="noopener noreferrer"`
      : "";
    inner = `<a href="${escapeHtml(href)}" class="notion-link link"${attrs}>${inner}</a>`;
  }

  if (annotations.underline) inner = `<u>${inner}</u>`;
  if (annotations.strikethrough) inner = `<s>${inner}</s>`;
  if (annotations.bold) inner = `<strong>${inner}</strong>`;
  if (annotations.code) inner = `<code class="code">${inner}</code>`;

  if (color.endsWith("_background")) {
    const bg = color.replace(/_background$/, "");
    const bgSafe = escapeHtml(bg);
    inner = `<span class="highlighted-background bg-${bgSafe}">${inner}</span>`;
    // Super wraps most background colors with a matching text color span so
    // inline <code> inherits the expected label color via `.highlighted-color .code`.
    if (bg !== "yellow") {
      inner = `<span class="highlighted-color color-${bgSafe}">${inner}</span>`;
    }
  } else if (color !== "default") {
    inner = `<span class="highlighted-color color-${escapeHtml(color)}">${inner}</span>`;
  }

  if (annotations.italic) inner = `<em>${inner}</em>`;

  return inner;
}

function collectHeadings(blocks, out = []) {
  for (const b of blocks) {
    const id = compactId(b.id);
    if (b.type === "heading_1") {
      out.push({ id, level: 1, text: richTextPlain(b.heading_1?.rich_text) });
    } else if (b.type === "heading_2") {
      out.push({ id, level: 2, text: richTextPlain(b.heading_2?.rich_text) });
    } else if (b.type === "heading_3") {
      out.push({ id, level: 3, text: richTextPlain(b.heading_3?.rich_text) });
    }
    if (Array.isArray(b.__children) && b.__children.length) {
      collectHeadings(b.__children, out);
    }
  }
  return out.filter((h) => h.text && h.text.trim());
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

async function renderBlocks(blocks, ctx) {
  let html = "";
  const arr = Array.isArray(blocks) ? blocks : [];

  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    if (!b || !b.type) continue;

    // Group list items into a single <ul>/<ol>.
    if (b.type === "bulleted_list_item" || b.type === "numbered_list_item") {
      const type = b.type;
      const items = [];
      let j = i;
      while (j < arr.length && arr[j]?.type === type) {
        items.push(arr[j]);
        j++;
      }
      i = j - 1;
      if (type === "bulleted_list_item") {
        html += `<ul class="notion-bulleted-list">`;
        for (const it of items) html += await renderBlock(it, ctx);
        html += `</ul>`;
      } else {
        html += `<ol type="1" class="notion-numbered-list">`;
        for (const it of items) html += await renderBlock(it, ctx);
        html += `</ol>`;
      }
      continue;
    }

    html += await renderBlock(b, ctx);
  }

  return html;
}

async function renderBlock(b, ctx) {
  const id = compactId(b.id);
  const blockIdAttr = `block-${id}`;

  if (b.type === "paragraph") {
    const rich = b.paragraph?.rich_text ?? [];
    if (!rich.length) {
      return `<div id="${blockIdAttr}" class="notion-text"></div>`;
    }
    return `<p id="${blockIdAttr}" class="notion-text notion-text__content notion-semantic-string">${renderRichText(rich, ctx)}</p>`;
  }

  if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
    const h = b[b.type] ?? {};
    const level = b.type === "heading_1" ? 1 : b.type === "heading_2" ? 2 : 3;
    const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
    const isToggleable = Boolean(h.is_toggleable);

    if (isToggleable) {
      const toggleClass = `notion-toggle-heading-${level}`;
      const kids = Array.isArray(b.__children) ? b.__children : [];
      return `<div id="${blockIdAttr}" class="notion-toggle closed ${toggleClass}"><div class="notion-toggle__summary"><div class="notion-toggle__trigger"><div class="notion-toggle__trigger_icon"><span>‣</span></div></div><span class="notion-heading__anchor" id="${id}"></span><${tag} id="${blockIdAttr}" class="notion-heading toggle notion-semantic-string">${renderRichText(h.rich_text ?? [], ctx)}</${tag}></div><div class="notion-toggle__content">${await renderBlocks(kids, ctx)}</div></div>`;
    }

    return `<span class="notion-heading__anchor" id="${id}"></span><${tag} id="${blockIdAttr}" class="notion-heading notion-semantic-string">${renderRichText(h.rich_text ?? [], ctx)}</${tag}>`;
  }

  if (b.type === "toggle") {
    const kids = Array.isArray(b.__children) ? b.__children : [];
    return `<div id="${blockIdAttr}" class="notion-toggle closed"><div class="notion-toggle__summary"><div class="notion-toggle__trigger"><div class="notion-toggle__trigger_icon"><span>‣</span></div></div><span class="notion-semantic-string">${renderRichText(
      b.toggle?.rich_text ?? [],
      ctx,
    )}</span></div><div class="notion-toggle__content">${await renderBlocks(kids, ctx)}</div></div>`;
  }

  if (b.type === "quote") {
    return `<blockquote id="${blockIdAttr}" class="notion-quote"><span class="notion-semantic-string">${renderRichText(
      b.quote?.rich_text ?? [],
      ctx,
    )}</span></blockquote>`;
  }

  if (b.type === "divider") {
    return `<div id="${blockIdAttr}" class="notion-divider"></div>`;
  }

  if (b.type === "equation") {
    const expr = b.equation?.expression ?? "";
    return `<span id="${blockIdAttr}" class="notion-equation notion-equation__block">${renderKatex(
      expr,
      { displayMode: true },
    )}</span>`;
  }

  if (b.type === "embed") {
    const e = b.embed ?? {};
    const url = String(e.url || "").trim();
    const caption = renderRichText(e.caption ?? [], ctx);
    const figcaption = caption
      ? `<figcaption class="notion-caption notion-semantic-string">${caption}</figcaption>`
      : "";

    let host = "";
    try {
      host = url ? new URL(url).hostname : "";
    } catch {
      // ignore
    }

    const sandbox =
      "allow-scripts allow-popups allow-forms allow-same-origin allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

    const iframe = url
      ? `<iframe src="${escapeHtml(
          url,
        )}" title="${escapeHtml(
          host || url,
        )}" sandbox="${escapeHtml(
          sandbox,
        )}" allowfullscreen="" loading="lazy" frameborder="0"></iframe>`
      : "";

    return `<span id="${blockIdAttr}" class="notion-embed" style="display:block;width:100%"><span class="notion-embed__content" style="display:flex;width:100%"><span class="notion-embed__loader" style="display:inline-block">${embedSpinnerSvg()}</span><span class="notion-embed__container__wrapper" style="width:100%;display:flex;height:320px"><span style="width:100%;height:100%;display:block" class="notion-embed__container">${iframe}</span></span></span>${figcaption}</span>`;
  }

  if (b.type === "table_of_contents") {
    const headings = ctx.headings ?? [];
    const items = headings
      .slice(0, 50)
      .map((h) => {
        const indent = h.level === 3 ? 12 : 0;
        return `<li class="notion-table-of-contents__item"><a class="notion-link" href="#block-${escapeHtml(
          h.id,
        )}"><div class="notion-semantic-string" style="margin-inline-start: ${indent}px;">${escapeHtml(
          h.text,
        )}</div></a></li>`;
      })
      .join("");
    return `<ul id="${blockIdAttr}" class="notion-table-of-contents color-gray">${items}</ul>`;
  }

  if (b.type === "table") {
    const t = b.table ?? {};
    const hasColumnHeader = Boolean(t.has_column_header);
    const hasRowHeader = Boolean(t.has_row_header);
    const rows = Array.isArray(b.__children) ? b.__children : [];

    let width = 0;
    const declared = Number(t.table_width ?? 0);
    if (Number.isFinite(declared) && declared > 0) width = declared;

    for (const r of rows) {
      const cells = r?.table_row?.cells;
      if (!Array.isArray(cells)) continue;
      width = Math.max(width, cells.length);
    }

    // Notion tables should always have at least 1 column.
    width = Math.max(1, width || 0);

    const rowHtml = rows
      .filter((r) => r?.type === "table_row" || r?.table_row)
      .map((r, rowIdx) => {
        const cells = Array.isArray(r?.table_row?.cells) ? r.table_row.cells : [];
        const tds = [];

        for (let col = 0; col < width; col++) {
          const cell = cells[col];
          const rich = Array.isArray(cell) ? cell : [];
          const content = rich.length ? renderRichText(rich, ctx) : "";
          const inner = content
            ? `<div class="notion-table__cell notion-semantic-string">${content}</div>`
            : `<div class="notion-table__cell notion-semantic-string"><div class="notion-table__empty-cell"></div></div>`;

          const isHeader =
            (hasColumnHeader && rowIdx === 0) || (hasRowHeader && col === 0);
          const tag = isHeader ? "th" : "td";
          tds.push(`<${tag}>${inner}</${tag}>`);
        }

        return `<tr>${tds.join("")}</tr>`;
      })
      .join("");

    const tableClasses = [
      "notion-table",
      hasColumnHeader ? "col-header" : "",
      hasRowHeader ? "row-header" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `<div id="${blockIdAttr}" class="notion-table__wrapper"><table class="${escapeHtml(
      tableClasses,
    )}">${rowHtml}</table></div>`;
  }

  if (b.type === "image") {
    const img = b.image ?? {};
    const src =
      img.type === "external"
        ? img.external?.url
        : img.type === "file"
          ? img.file?.url
          : "";
    const stableName = id || `image-${Math.random().toString(16).slice(2)}`;
    const publicSrc =
      img.type === "file" && src ? await downloadAsset(src, stableName) : src;
    const caption = renderRichText(img.caption ?? [], ctx);
    const figcaption = caption
      ? `<figcaption class="notion-caption notion-semantic-string">${caption}</figcaption>`
      : "";
    const altText = escapeHtml(richTextPlain(img.caption ?? []) || "image");
    // Super's default alignment is start, even inside columns.
    return `<div id="${blockIdAttr}" class="notion-image align-start page-width"><span data-full-size="${escapeHtml(
      publicSrc || "",
    )}" data-lightbox-src="${escapeHtml(
      publicSrc || "",
    )}" style="display:contents"><img alt="${altText}" loading="lazy" decoding="async" style="color: transparent; height: auto;" src="${escapeHtml(
      publicSrc || "",
    )}"></span>${figcaption}</div>`;
  }

  if (b.type === "code") {
    const code = b.code ?? {};
    const lang = String(code.language || "plain").toLowerCase();
    const codeText = richTextPlain(code.rich_text ?? []);
    const caption = renderRichText(code.caption ?? [], ctx);
    const figcaption = `<figcaption class="notion-caption notion-semantic-string">${caption}</figcaption>`;
    const copyIcon = `<svg class="notion-icon notion-icon__copy" viewBox="0 0 14 16"><path d="M2.404 15.322h5.701c1.26 0 1.887-.662 1.887-1.927V12.38h1.154c1.254 0 1.91-.662 1.91-1.928V5.555c0-.774-.158-1.266-.626-1.74L9.512.837C9.066.387 8.545.21 7.865.21H5.463c-1.254 0-1.91.662-1.91 1.928v1.084H2.404c-1.254 0-1.91.668-1.91 1.933v8.239c0 1.265.656 1.927 1.91 1.927zm7.588-6.62c0-.792-.1-1.161-.592-1.665L6.225 3.814c-.452-.462-.844-.58-1.5-.591V2.215c0-.533.28-.832.843-.832h2.38v2.883c0 .726.386 1.113 1.107 1.113h2.83v4.998c0 .539-.276.832-.844.832H9.992V8.701zm-.79-4.29c-.206 0-.288-.088-.288-.287V1.594l2.771 2.818H9.201zM2.503 14.15c-.563 0-.844-.293-.844-.832V5.232c0-.539.281-.837.85-.837h1.91v3.187c0 .85.416 1.26 1.26 1.26h3.14v4.476c0 .54-.28.832-.843.832H2.504zM5.79 7.816c-.24 0-.346-.105-.346-.345V4.547l3.223 3.27H5.791z"></path></svg>`;
    return `<div id="${blockIdAttr}" class="notion-code no-wrap"><button class="notion-code__copy-button">${copyIcon}Copy</button><pre class="language-${escapeHtml(
      lang,
    )}" tabindex="0"><code class="language-${escapeHtml(
      lang,
    )}">${escapeHtml(codeText)}</code></pre>${figcaption}</div>`;
  }

  if (b.type === "callout") {
    const c = b.callout ?? {};
    const bg = pickCalloutBgClass(c.color);
    const icon = c.icon?.type === "emoji" ? c.icon.emoji : "💡";
    const kids = Array.isArray(b.__children) ? b.__children : [];
    const text = renderRichText(c.rich_text ?? [], ctx);
    const body = kids.length ? await renderBlocks(kids, ctx) : "";
    return `<div id="${blockIdAttr}" class="notion-callout ${escapeHtml(
      bg,
    )} border"><div class="notion-callout__icon"><span class="notion-icon text" style="width:20px;height:20px;font-size:20px;fill:var(--color-text-default-light)">${escapeHtml(
      icon,
    )}</span></div><div class="notion-callout__content"><span class="notion-semantic-string">${text}</span>${body}</div></div>`;
  }

  if (b.type === "column_list") {
    const cols = Array.isArray(b.__children) ? b.__children : [];
    const n = cols.length || 1;

    // Notion provides `column.width_ratio` for column blocks. Super computes
    // widths sequentially from left-to-right: each non-last column gets a
    // (remaining / remainingColumns) * width_ratio share; the last column gets
    // the remaining space. This matches the original site proportions.
    const widths = [];
    let remaining = 1;
    for (let i = 0; i < cols.length; i++) {
      if (i === cols.length - 1) {
        widths.push(remaining);
        break;
      }
      const ratioRaw = Number(cols[i]?.column?.width_ratio);
      const ratio = Number.isFinite(ratioRaw) && ratioRaw > 0 ? ratioRaw : 1;
      const defaultWidth = remaining / (cols.length - i);
      let w = defaultWidth * ratio;
      // Clamp to avoid invalid CSS in case Notion data is unexpected.
      w = Math.max(0, Math.min(remaining, w));
      widths.push(w);
      remaining -= w;
    }

    let inner = `<div id="${blockIdAttr}" class="notion-column-list">`;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const colId = compactId(col.id);
      const frac = widths[i] ?? 1 / n;
      const width = `(100% - var(--column-spacing) * ${n - 1}) * ${frac}`;
      const margin = i === 0 ? "" : `;margin-inline-start:var(--column-spacing)`;
      const colKids = Array.isArray(col.__children) ? col.__children : [];
      inner += `<div id="block-${colId}" class="notion-column" style="width:calc(${width})${margin}">${await renderBlocks(
        colKids,
        ctx,
      )}</div>`;
    }
    inner += `</div>`;
    return inner;
  }

  if (b.type === "bulleted_list_item") {
    const kids = Array.isArray(b.__children) ? b.__children : [];
    const inner = renderRichText(b.bulleted_list_item?.rich_text ?? [], ctx);
    const nested = kids.length ? await renderBlocks(kids, ctx) : "";
    return `<li id="${blockIdAttr}" class="notion-list-item notion-semantic-string">${inner}${nested}</li>`;
  }

  if (b.type === "numbered_list_item") {
    const kids = Array.isArray(b.__children) ? b.__children : [];
    const inner = renderRichText(b.numbered_list_item?.rich_text ?? [], ctx);
    const nested = kids.length ? await renderBlocks(kids, ctx) : "";
    return `<li id="${blockIdAttr}" class="notion-list-item notion-semantic-string">${inner}${nested}</li>`;
  }

  if (b.type === "child_database") {
    const dbId = compactId(b.id);
    const db = ctx.dbById?.get?.(dbId) ?? null;
    const title = String(b.child_database?.title ?? "").trim() || db?.title || "List";

    if (!db) {
      const href = ctx.routeByPageId.get(dbId) ?? "#";
      return `<a id="${blockIdAttr}" href="${escapeHtml(
        href,
      )}" class="notion-page"><span class="notion-page__icon">${pageIconSvg()}</span><span class="notion-page__title notion-semantic-string">${escapeHtml(
        title,
      )}</span></a>`;
    }

    const pageKey =
      db.routePath === "/"
        ? "index"
        : db.routePath.replace(/^\/+/, "").replace(/\//g, "-");
    const items = (db.children || [])
      .filter((x) => x.kind !== "database")
      .map((it) => renderCollectionListItem(it, { listKey: pageKey }))
      .join("");

    return `<div id="${blockIdAttr}" class="notion-collection inline"><div class="notion-collection__header-wrapper"><h3 class="notion-collection__header"><span class="notion-semantic-string">${escapeHtml(
      title,
    )}</span></h3></div><div class="notion-collection-list" role="list" aria-label="${escapeHtml(
      title,
    )}">${items}</div></div>`;
  }

  if (b.type === "child_page") {
    const title = b.child_page?.title ?? "Untitled";
    const pageId = compactId(b.id);
    const href = ctx.routeByPageId.get(pageId) ?? "#";
    const idAttr = `block-${slugify(title) || pageId}`;
    return `<a id="${escapeHtml(
      idAttr,
    )}" href="${escapeHtml(href)}" class="notion-page"><span class="notion-page__icon">${pageIconSvg()}</span><span class="notion-page__title notion-semantic-string">${escapeHtml(
      title,
    )}</span></a>`;
  }

  // Fallback: if the block has children, still render them so content isn't lost.
  const kids = Array.isArray(b.__children) ? b.__children : [];
  if (kids.length) {
    // Some Notion block types still come back as `unsupported` but their children
    // are still usable. Most importantly: tables. If we see a block whose children
    // are entirely table rows, render it as a table instead of dropping it.
    const tableRows = kids.filter((k) => k?.type === "table_row" || k?.table_row);
    const looksLikeTable = tableRows.length > 0 && tableRows.length === kids.length;
    if (looksLikeTable) {
      let width = 0;
      for (const r of tableRows) {
        const cells = r?.table_row?.cells;
        if (!Array.isArray(cells)) continue;
        width = Math.max(width, cells.length);
      }
      width = Math.max(1, width || 0);

      const rowHtml = tableRows
        .map((r) => {
          const cells = Array.isArray(r?.table_row?.cells) ? r.table_row.cells : [];
          const tds = [];
          for (let col = 0; col < width; col++) {
            const cell = cells[col];
            const rich = Array.isArray(cell) ? cell : [];
            const content = rich.length ? renderRichText(rich, ctx) : "";
            const inner = content
              ? `<div class="notion-table__cell notion-semantic-string">${content}</div>`
              : `<div class="notion-table__cell notion-semantic-string"><div class="notion-table__empty-cell"></div></div>`;
            tds.push(`<td>${inner}</td>`);
          }
          return `<tr>${tds.join("")}</tr>`;
        })
        .join("");

      return `<div id="${blockIdAttr}" class="notion-table__wrapper"><table class="notion-table">${rowHtml}</table></div>`;
    }

    return `<div id="${blockIdAttr}" class="notion-unsupported">${await renderBlocks(
      kids,
      ctx,
    )}</div>`;
  }
  return "";
}

async function renderPageMain(page, blocks, cfg, ctx) {
  const pageKey =
    page.routePath === "/"
      ? "index"
      : page.routePath.replace(/^\/+/, "").replace(/\//g, "-");
  const parentKey =
    page.parentRoutePath === "/"
      ? "index"
      : (page.parentRoutePath || "/").replace(/^\/+/, "").replace(/\//g, "-") ||
        "index";

  const mainId = `page-${pageKey}`;
  const mainClass = `super-content page__${pageKey} parent-page__${parentKey}`;
  const breadcrumbs = renderBreadcrumbs(page, cfg, ctx);

  // Headings needed for TOC blocks.
  const headings = collectHeadings(blocks);
  const localCtx = { ...ctx, headings };

  const body = await renderBlocks(blocks, localCtx);
  const propsHtml = page.__page ? renderPagePropertiesFromPageObject(page.__page) : "";

  return `<main id="${escapeHtml(mainId)}" class="${escapeHtml(
    mainClass,
  )}">${breadcrumbs}<div class="notion-header page"><div class="notion-header__cover no-cover no-icon"></div><div class="notion-header__content max-width no-cover no-icon"><div class="notion-header__title-wrapper"><h1 class="notion-header__title">${escapeHtml(
    page.title,
  )}</h1></div></div></div><article id="block-${escapeHtml(
    pageKey,
  )}" class="notion-root max-width has-footer">${propsHtml}${body}</article></main>`;
}

function renderCollectionListItem(item, { listKey }) {
  const slug = item.routePath.split("/").filter(Boolean).slice(-1)[0] || item.id.slice(0, 8);
  const blockId = `block-${listKey}-${slug}`;

  const date = item.__date;
  const propId = date?.id ? String(date.id).replace(/[^a-z0-9]/gi, "") : "";
  const dateClass = propId ? ` property-${escapeHtml(propId)}` : "";
  const dateHtml = date?.text
    ? `<div class="notion-property notion-property__date${dateClass} notion-collection-list__item-property notion-semantic-string no-wrap"><span class="date">${escapeHtml(
        date.text,
      )}</span></div>`
    : "";

  const href = canonicalizePublicHref(item.routePath);

  return `<div id="${escapeHtml(
    blockId,
  )}" class="notion-collection-list__item "><a id="${escapeHtml(
    blockId,
  )}" href="${escapeHtml(
    href,
  )}" class="notion-link notion-collection-list__item-anchor"></a><div class="notion-property notion-property__title notion-semantic-string"><div class="notion-property__title__icon-wrapper">${pageIconSvg()}</div>${escapeHtml(
    item.title,
  )}</div><div class="notion-collection-list__item-content">${dateHtml}</div></div>`;
}

function renderDatabaseMain(db, cfg, ctx) {
  const pageKey =
    db.routePath === "/" ? "index" : db.routePath.replace(/^\/+/, "").replace(/\//g, "-");
  const parentKey =
    db.parentRoutePath === "/"
      ? "index"
      : (db.parentRoutePath || "/").replace(/^\/+/, "").replace(/\//g, "-") ||
        "index";

  const mainId = `page-${pageKey}`;
  const mainClass = `super-content page__${pageKey} parent-page__${parentKey}`;
  const breadcrumbs = renderBreadcrumbs(db, cfg, ctx);

  const items = (db.children || [])
    .filter((x) => x.kind !== "database")
    .map((it) => renderCollectionListItem(it, { listKey: pageKey }))
    .join("");

  return `<main id="${escapeHtml(
    mainId,
  )}" class="${escapeHtml(
    mainClass,
  )}">${breadcrumbs}<div class="notion-header collection"><div class="notion-header__cover no-cover no-icon"></div><div class="notion-header__content no-cover no-icon"><div class="notion-header__title-wrapper" style="display:flex"><h1 class="notion-header__title">${escapeHtml(
    db.title,
  )}</h1></div><div class="notion-header__description notion-semantic-string"></div></div></div><article id="block-${escapeHtml(
    pageKey,
  )}" class="notion-root full-width has-footer notion-collection notion-collection-page collection-${escapeHtml(
    db.id,
  )}"><div class="notion-collection-list">${items}</div></article></main>`;
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
  const ctx = { routeByPageId, dbById, nodeById, homeTitle, homePageId: homeRoutePageId };

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
              writeJsonAtomic(cachePath, { lastEdited, html, text: fields.text });
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
