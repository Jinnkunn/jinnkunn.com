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

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "content", "generated");
const OUT_RAW_DIR = path.join(OUT_DIR, "raw");
const OUT_PUBLIC_ASSETS_DIR = path.join(ROOT, "public", "notion-assets");

const DEFAULT_CONFIG = {
  siteName: "Jinkun Chen.",
  lang: "en",
  seo: {
    title: "Jinkun Chen",
    description:
      "Jinkun Chen (he/him/his) — Ph.D. student studying Computer Science at Dalhousie University.",
    favicon: "/assets/favicon.png",
  },
  nav: {
    top: [
      { href: "/", label: "Home" },
      { href: "/news", label: "News" },
      { href: "/publications", label: "Publications" },
      { href: "/works", label: "Works" },
    ],
    more: [
      { href: "/blog", label: "Blog" },
      { href: "/teaching", label: "Teaching" },
      { href: "/bio", label: "BIO" },
      { href: "/notice", label: "Notice" },
    ],
  },
  content: {
    rootPageId: null, // defaults to NOTION_SITE_ADMIN_PAGE_ID
    homePageId: null, // defaults to first child page titled "Home"/"Index" (or the first child page)
    // Optional: map Notion page id -> route path (e.g. { "<pageId>": "/chen" }).
    routeOverrides: null,
  },
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function compactId(idOrUrl) {
  const s = String(idOrUrl || "").trim();
  const m =
    s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ||
    s.match(/[0-9a-f]{32}/i);
  if (!m) return "";
  return m[0].replace(/-/g, "").toLowerCase();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function isObject(x) {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function deepMerge(base, patch) {
  if (!isObject(patch)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isObject(out[k]) && isObject(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function slugify(input) {
  const s = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return s;
}

function normalizeRoutePath(p) {
  const raw = String(p || "").trim();
  if (!raw) return "";
  let out = raw.startsWith("/") ? raw : `/${raw}`;
  out = out.replace(/\/+$/g, "");
  return out || "/";
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function notionRequest(pathname, { method = "GET", body, searchParams } = {}) {
  const token = process.env.NOTION_TOKEN?.trim() ?? "";
  if (!token) throw new Error("Missing NOTION_TOKEN");

  const url = new URL(`${NOTION_API}/${pathname}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (res.ok) return json;

    // Retry rate-limit / transient 5xx.
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(
        `Notion API error ${res.status} for ${pathname}: ${text?.slice(0, 200)}`,
      );
      await sleep(250 * Math.pow(2, attempt));
      continue;
    }

    throw new Error(
      `Notion API error ${res.status} for ${pathname}: ${text?.slice(0, 400)}`,
    );
  }

  throw lastErr ?? new Error(`Notion API request failed for ${pathname}`);
}

async function listBlockChildren(blockId) {
  const out = [];
  let cursor = undefined;
  // Notion max is 100.
  for (;;) {
    const data = await notionRequest(`blocks/${blockId}/children`, {
      searchParams: { page_size: 100, start_cursor: cursor },
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.has_more) break;
    cursor = data?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

async function queryDatabase(databaseId, { filter, sorts } = {}) {
  const out = [];
  let cursor = undefined;
  for (;;) {
    const data = await notionRequest(`databases/${databaseId}/query`, {
      method: "POST",
      body: {
        page_size: 100,
        start_cursor: cursor,
        filter,
        sorts,
      },
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.has_more) break;
    cursor = data?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

async function hydrateBlocks(blocks) {
  for (const b of blocks) {
    if (b?.has_children) {
      const kids = await listBlockChildren(b.id);
      b.__children = await hydrateBlocks(kids);
    }
  }
  return blocks;
}

async function findFirstJsonCodeBlock(blockId, maxDepth = 4) {
  const blocks = await listBlockChildren(blockId);
  for (const b of blocks) {
    if (b?.type !== "code") continue;
    const rt = b?.code?.rich_text ?? [];
    const text = rt.map((x) => x?.plain_text ?? "").join("");
    const t = text.trim();
    if (!t.startsWith("{")) continue;
    try {
      JSON.parse(t);
      return t;
    } catch {
      // keep searching
    }
  }

  if (maxDepth <= 0) return null;
  for (const b of blocks) {
    if (!b?.has_children) continue;
    const found = await findFirstJsonCodeBlock(b.id, maxDepth - 1);
    if (found) return found;
  }

  return null;
}

async function findChildDatabases(blockId, maxDepth = 4) {
  const out = [];
  const blocks = await listBlockChildren(blockId);
  for (const b of blocks) {
    if (b?.type === "child_database") {
      out.push({
        id: compactId(b.id),
        title: b.child_database?.title ?? "",
      });
      continue;
    }
  }

  if (maxDepth <= 0) return out;
  for (const b of blocks) {
    if (!b?.has_children) continue;
    out.push(...(await findChildDatabases(b.id, maxDepth - 1)));
  }

  return out;
}

function propPlainTextFromRichText(prop) {
  const rt = prop?.rich_text ?? [];
  if (!Array.isArray(rt)) return "";
  return rt.map((x) => x?.plain_text ?? "").join("");
}

function propPlainTextFromTitle(prop) {
  const rt = prop?.title ?? [];
  if (!Array.isArray(rt)) return "";
  return rt.map((x) => x?.plain_text ?? "").join("");
}

function getProperty(page, name) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  return props[name];
}

function getPropString(page, name) {
  const p = getProperty(page, name);
  if (!p || typeof p !== "object") return "";
  if (p.type === "title") return propPlainTextFromTitle(p).trim();
  if (p.type === "rich_text") return propPlainTextFromRichText(p).trim();
  if (p.type === "select") return (p.select?.name ?? "").trim();
  if (p.type === "url") return (p.url ?? "").trim();
  return "";
}

function getPropNumber(page, name) {
  const p = getProperty(page, name);
  if (!p || typeof p !== "object") return null;
  if (p.type !== "number") return null;
  return typeof p.number === "number" ? p.number : null;
}

function getPropCheckbox(page, name) {
  const p = getProperty(page, name);
  if (!p || typeof p !== "object") return null;
  if (p.type !== "checkbox") return null;
  return typeof p.checkbox === "boolean" ? p.checkbox : null;
}

function findDbByTitle(databases, title) {
  const want = slugify(title);
  return databases.find((d) => slugify(d.title) === want) || null;
}

async function loadConfigFromAdminDatabases(adminPageId) {
  // These databases are provisioned by `scripts/provision-site-admin.mjs`.
  const databases = await findChildDatabases(adminPageId);
  const settingsDb = findDbByTitle(databases, "Site Settings");
  const navDb = findDbByTitle(databases, "Navigation");
  const overridesDb = findDbByTitle(databases, "Route Overrides");

  if (!settingsDb && !navDb && !overridesDb) return null;

  const cfg = structuredClone(DEFAULT_CONFIG);

  // 1) Site Settings (single-row)
  if (settingsDb) {
    const rows = await queryDatabase(settingsDb.id);
    const row = rows[0];
    if (row) {
      const siteName = getPropString(row, "Site Name");
      const lang = getPropString(row, "Lang");
      const seoTitle = getPropString(row, "SEO Title");
      const seoDescription = getPropString(row, "SEO Description");
      const favicon = getPropString(row, "Favicon");
      const rootPageId = getPropString(row, "Root Page ID");
      const homePageId = getPropString(row, "Home Page ID");

      if (siteName) cfg.siteName = siteName;
      if (lang) cfg.lang = lang;
      if (seoTitle) cfg.seo.title = seoTitle;
      if (seoDescription) cfg.seo.description = seoDescription;
      if (favicon) cfg.seo.favicon = favicon;
      if (rootPageId) cfg.content.rootPageId = rootPageId;
      if (homePageId) cfg.content.homePageId = homePageId;
    }
  }

  // 2) Navigation
  if (navDb) {
    const rows = await queryDatabase(navDb.id);
    const items = rows
      .map((row) => {
        const enabled = getPropCheckbox(row, "Enabled");
        const group = (getPropString(row, "Group") || "").toLowerCase();
        const href = getPropString(row, "Href");
        const label = getPropString(row, "Label") || getPropString(row, "Name");
        const order = getPropNumber(row, "Order") ?? 0;
        return { enabled, group, href, label, order };
      })
      .filter((it) => (it.enabled ?? true) && it.href && it.label && it.group);

    const sortByOrder = (a, b) => (a.order || 0) - (b.order || 0);
    const top = items
      .filter((it) => it.group === "top")
      .sort(sortByOrder)
      .map(({ href, label }) => ({ href, label }));
    const more = items
      .filter((it) => it.group === "more")
      .sort(sortByOrder)
      .map(({ href, label }) => ({ href, label }));

    if (top.length) cfg.nav.top = top;
    if (more.length) cfg.nav.more = more;
  }

  // 3) Route Overrides
  if (overridesDb) {
    const rows = await queryDatabase(overridesDb.id);
    const overrides = {};
    for (const row of rows) {
      const enabled = getPropCheckbox(row, "Enabled");
      if (enabled === false) continue;
      const pageId = getPropString(row, "Page ID");
      const routePath = getPropString(row, "Route Path");
      if (!pageId || !routePath) continue;
      overrides[pageId] = routePath;
    }
    if (Object.keys(overrides).length) cfg.content.routeOverrides = overrides;
  }

  return cfg;
}

async function getPageTitle(pageId) {
  const data = await notionRequest(`pages/${pageId}`);
  const props = data?.properties && typeof data.properties === "object" ? data.properties : {};
  for (const v of Object.values(props)) {
    if (v && typeof v === "object" && v.type === "title") {
      return richTextPlain(v.title ?? []) || "Untitled";
    }
  }
  return "Untitled";
}

async function buildPageTree(parentPageId) {
  const blocks = await listBlockChildren(parentPageId);
  const pages = blocks
    .filter((b) => b?.type === "child_page" && b?.child_page?.title)
    .map((b) => ({
      id: compactId(b.id),
      title: b.child_page.title,
      children: [],
      parentId: compactId(parentPageId),
      routePath: "",
      routeSegments: [],
    }));

  for (const p of pages) {
    p.children = await buildPageTree(p.id);
  }

  return pages;
}

function pickHomePageId(nodes, cfg) {
  const configured = compactId(cfg?.content?.homePageId);
  if (configured) return configured;
  const byTitle = nodes.find((n) => {
    const s = slugify(n.title);
    return s === "home" || s === "index";
  });
  if (byTitle) return byTitle.id;
  return nodes[0]?.id ?? "";
}

function assignRoutes(nodes, { homePageId, routeOverrides }, parentSegments = []) {
  const used = new Set();

  for (const n of nodes) {
    const desired = slugify(n.title) || `page-${n.id.slice(0, 8)}`;

    if (parentSegments.length === 0 && n.id === homePageId) {
      n.routeSegments = [];
      n.routePath = "/";
    } else if (routeOverrides && routeOverrides.has(n.id)) {
      const routePath = routeOverrides.get(n.id);
      n.routePath = routePath;
      n.routeSegments =
        routePath === "/" ? [] : routePath.split("/").filter(Boolean);
    } else {
      let seg = desired;
      if (used.has(seg)) seg = `${seg}-${n.id.slice(0, 6)}`;
      used.add(seg);
      n.routeSegments = [...parentSegments, seg];
      n.routePath = `/${n.routeSegments.join("/")}`;
    }

    const nextParentSegments = n.routePath === "/" ? [] : n.routeSegments;
    assignRoutes(n.children, { homePageId, routeOverrides }, nextParentSegments);
  }
}

function flattenPages(nodes) {
  const out = [];
  const walk = (n) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
}

function routePathToHtmlRel(routePath) {
  if (routePath === "/") return "index.html";
  return routePath.replace(/^\/+/, "") + ".html";
}

function pickCalloutBgClass(color) {
  const c = String(color || "default").replace(/_background$/, "");
  if (c === "default") return "bg-gray-light";
  return `bg-${c}-light`;
}

function pageIconSvg() {
  // Matches the common "page" icon used by Super.
  return `<svg class="notion-icon notion-icon__page" viewBox="0 0 16 16" width="18" height="18" style="width: 20px; height: 20px; font-size: 20px; fill: var(--color-text-default-light);"><path d="M4.35645 15.4678H11.6367C13.0996 15.4678 13.8584 14.6953 13.8584 13.2256V7.02539C13.8584 6.0752 13.7354 5.6377 13.1406 5.03613L9.55176 1.38574C8.97754 0.804688 8.50586 0.667969 7.65137 0.667969H4.35645C2.89355 0.667969 2.13477 1.44043 2.13477 2.91016V13.2256C2.13477 14.7021 2.89355 15.4678 4.35645 15.4678ZM4.46582 14.1279C3.80273 14.1279 3.47461 13.7793 3.47461 13.1436V2.99219C3.47461 2.36328 3.80273 2.00781 4.46582 2.00781H7.37793V5.75391C7.37793 6.73145 7.86328 7.20312 8.83398 7.20312H12.5186V13.1436C12.5186 13.7793 12.1836 14.1279 11.5205 14.1279H4.46582ZM8.95703 6.02734C8.67676 6.02734 8.56055 5.9043 8.56055 5.62402V2.19238L12.334 6.02734H8.95703ZM10.4336 9.00098H5.42969C5.16992 9.00098 4.98535 9.19238 4.98535 9.43164C4.98535 9.67773 5.16992 9.86914 5.42969 9.86914H10.4336C10.6797 9.86914 10.8643 9.67773 10.8643 9.43164C10.8643 9.19238 10.6797 9.00098 10.4336 9.00098ZM10.4336 11.2979H5.42969C5.16992 11.2979 4.98535 11.4893 4.98535 11.7354C4.98535 11.9746 5.16992 12.1592 5.42969 12.1592H10.4336C10.6797 12.1592 10.8643 11.9746 10.8643 11.7354C10.8643 11.4893 10.6797 11.2979 10.4336 11.2979Z"></path></svg>`;
}

function richTextPlain(richText) {
  return (richText || []).map((x) => x?.plain_text ?? "").join("");
}

function renderRichText(richText, ctx) {
  const items = Array.isArray(richText) ? richText : [];
  return items.map((rt) => renderRichTextItem(rt, ctx)).join("");
}

function renderRichTextItem(rt, ctx) {
  const annotations = rt?.annotations ?? {};
  const color = String(annotations.color || "default");
  const href =
    rt?.href ||
    rt?.text?.link?.url ||
    (rt?.type === "mention" && rt?.mention?.type === "page"
      ? ctx.routeByPageId.get(compactId(rt?.mention?.page?.id)) || ""
      : "");

  let inner = escapeHtml(rt?.plain_text ?? "");

  if (annotations.code) inner = `<code class="code">${inner}</code>`;
  if (annotations.bold) inner = `<strong>${inner}</strong>`;
  if (annotations.italic) inner = `<em>${inner}</em>`;
  if (annotations.underline) inner = `<u>${inner}</u>`;
  if (annotations.strikethrough) inner = `<s>${inner}</s>`;

  if (href) {
    const external = /^https?:\/\//i.test(href);
    const attrs = external
      ? ` target="_blank" rel="noopener noreferrer"`
      : "";
    inner = `<a href="${escapeHtml(href)}" class="notion-link link"${attrs}>${inner}</a>`;
  }

  if (color.endsWith("_background")) {
    const bg = color.replace(/_background$/, "");
    inner = `<span class="highlighted-background bg-${escapeHtml(bg)}">${inner}</span>`;
  } else if (color !== "default") {
    inner = `<span class="highlighted-color color-${escapeHtml(color)}">${inner}</span>`;
  }

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
    return `<div id="${blockIdAttr}" class="notion-image page-width"><span data-full-size="${escapeHtml(
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
    let inner = `<div id="${blockIdAttr}" class="notion-column-list">`;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const colId = compactId(col.id);
      const width = `(100% - var(--column-spacing) * ${n - 1}) * ${1 / n}`;
      const margin = i === 0 ? "" : ` margin-inline-start: var(--column-spacing);`;
      const colKids = Array.isArray(col.__children) ? col.__children : [];
      inner += `<div id="block-${colId}" class="notion-column" style="width: calc(${width});${margin}">${await renderBlocks(
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
    return `<div id="${blockIdAttr}" class="notion-unsupported">${await renderBlocks(
      kids,
      ctx,
    )}</div>`;
  }
  return "";
}

function renderBreadcrumbs(routePath, title, cfg) {
  if (routePath === "/") return "";
  const crumbs = [
    `<a href="/" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">${escapeHtml(
      cfg.nav?.top?.find?.((x) => x.href === "/")?.label || "Home",
    )}</div></a>`,
  ];

  // Keep MVP simple: only show the current page.
  crumbs.push(`<span class="notion-breadcrumb__divider">/</span>`);
  crumbs.push(
    `<a href="${escapeHtml(
      routePath,
    )}" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">${escapeHtml(
      title,
    )}</div></a>`,
  );

  return `<div class="super-navbar__breadcrumbs" style="position:absolute"><div class="notion-breadcrumb">${crumbs.join(
    "",
  )}</div></div>`;
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
  const breadcrumbs = renderBreadcrumbs(page.routePath, page.title, cfg);

  // Headings needed for TOC blocks.
  const headings = collectHeadings(blocks);
  const localCtx = { ...ctx, headings };

  const body = await renderBlocks(blocks, localCtx);

  return `<main id="${escapeHtml(mainId)}" class="${escapeHtml(
    mainClass,
  )}">${breadcrumbs}<div class="notion-header page"><div class="notion-header__cover no-cover no-icon"></div><div class="notion-header__content max-width no-cover no-icon"><div class="notion-header__title-wrapper"><h1 class="notion-header__title">${escapeHtml(
    page.title,
  )}</h1></div></div></div><article id="block-${escapeHtml(
    pageKey,
  )}" class="notion-root max-width has-footer">${body}</article></main>`;
}

async function main() {
  const adminPageId = compactId(process.env.NOTION_SITE_ADMIN_PAGE_ID);
  if (!adminPageId) {
    throw new Error(
      "Missing NOTION_SITE_ADMIN_PAGE_ID (expected a Notion page id or URL)",
    );
  }

  const dbCfg = await loadConfigFromAdminDatabases(adminPageId);
  const configJson = dbCfg ? null : await findFirstJsonCodeBlock(adminPageId);
  const parsed = configJson ? JSON.parse(configJson) : {};
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
    const rootNode = {
      id: rootPageId,
      title: rootTitle,
      children: await buildPageTree(rootPageId),
      parentId: "",
      routePath: "/",
      routeSegments: [],
    };

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
    const top = await buildPageTree(rootPageId);
    if (!top.length) {
      throw new Error(
        "No child pages found under the configured content root page. Create child pages under the root page (or set content.rootPageId).",
      );
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

  // Sync pages.
  console.log(`[sync:notion] Pages: ${allPages.length}`);
  const ctx = { routeByPageId };

  for (const p of allPages) {
    const blocks = await hydrateBlocks(await listBlockChildren(p.id));
    const mainHtml = await renderPageMain(p, blocks, cfg, ctx);
    const rel = routePathToHtmlRel(p.routePath);
    const outPath = path.join(OUT_RAW_DIR, rel);
    writeFile(outPath, mainHtml + "\n");
    console.log(`[sync:notion] Wrote ${rel}`);
  }

  // Small debug artifact: route map.
  const routes = Object.fromEntries(allPages.map((p) => [p.routePath, p.id]));
  writeFile(path.join(OUT_DIR, "routes.json"), JSON.stringify(routes, null, 2) + "\n");

  console.log("[sync:notion] Done.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
