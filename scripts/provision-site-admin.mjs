/* Provision a Notion "Site Admin" page with structured databases so the page
 * feels like a real backend (Super.so style).
 *
 * This is intended as a one-time setup helper. The site build uses
 * `scripts/sync-notion.mjs`, which will prefer these databases (if present),
 * and fall back to the legacy JSON code block if not.
 *
 * Required env:
 * - NOTION_TOKEN
 * - NOTION_SITE_ADMIN_PAGE_ID (page id or URL)
 *
 * Optional:
 * - NOTION_VERSION (default: 2022-06-28)
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

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
    rootPageId: null,
    homePageId: null,
    routeOverrides: null,
  },
};

function compactId(idOrUrl) {
  const s = String(idOrUrl || "").trim();
  const m =
    s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ||
    s.match(/[0-9a-f]{32}/i);
  if (!m) return "";
  return m[0].replace(/-/g, "").toLowerCase();
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

function richText(content) {
  const c = String(content ?? "").trim();
  if (!c) return [];
  return [{ type: "text", text: { content: c } }];
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
  if (!res.ok) {
    throw new Error(
      `Notion API error ${res.status} for ${pathname}: ${text?.slice(0, 400)}`,
    );
  }
  return json;
}

async function listBlockChildren(blockId) {
  const out = [];
  let cursor = undefined;
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

async function appendBlocks(parentBlockId, children) {
  if (!children.length) return;
  await notionRequest(`blocks/${parentBlockId}/children`, {
    method: "PATCH",
    body: { children },
  });
}

async function updateBlock(blockId, patch) {
  await notionRequest(`blocks/${blockId}`, { method: "PATCH", body: patch });
}

async function findFirstJsonCodeBlock(blockId) {
  const blocks = await listBlockChildren(blockId);
  for (const b of blocks) {
    if (b?.type !== "code") continue;
    const rt = b?.code?.rich_text ?? [];
    const text = rt.map((x) => x?.plain_text ?? "").join("");
    const t = text.trim();
    if (!t.startsWith("{")) continue;
    try {
      JSON.parse(t);
      return { blockId: compactId(b.id), json: t };
    } catch {
      // keep looking
    }
  }
  return null;
}

function findTextBlock(blocks, { type, includes }) {
  const want = String(includes || "").toLowerCase();
  for (const b of blocks) {
    if (b?.type !== type) continue;
    const rt = b?.[type]?.rich_text ?? [];
    const text = rt.map((x) => x?.plain_text ?? "").join("");
    if (text.toLowerCase().includes(want)) return b;
  }
  return null;
}

function findHeadingBlock(blocks, { level, includes }) {
  const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
  return findTextBlock(blocks, { type, includes });
}

function findChildDatabaseBlock(blocks, title) {
  const want = String(title || "").trim().toLowerCase();
  for (const b of blocks) {
    if (b?.type !== "child_database") continue;
    const t = String(b.child_database?.title ?? "").trim().toLowerCase();
    if (t === want) return b;
  }
  return null;
}

async function createInlineDatabase({
  parentPageId,
  title,
  properties,
}) {
  const db = await notionRequest("databases", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: richText(title),
      is_inline: true,
      properties,
    },
  });
  return compactId(db?.id);
}

async function createDatabaseRow({ databaseId, properties }) {
  await notionRequest("pages", {
    method: "POST",
    body: {
      parent: { database_id: databaseId },
      properties,
    },
  });
}

async function main() {
  const adminPageId = compactId(process.env.NOTION_SITE_ADMIN_PAGE_ID);
  if (!adminPageId) {
    throw new Error("Missing NOTION_SITE_ADMIN_PAGE_ID (expected a Notion page id or URL)");
  }

  const blocks = await listBlockChildren(adminPageId);

  // Use existing JSON config as a seed source (so we don't require extra env vars).
  const jsonBlock = await findFirstJsonCodeBlock(adminPageId);
  const parsed = jsonBlock?.json ? JSON.parse(jsonBlock.json) : {};
  const cfg = deepMerge(DEFAULT_CONFIG, parsed);

  // Update copy to point people at the databases first.
  const intro = findTextBlock(blocks, { type: "paragraph", includes: "site backend" });
  if (intro) {
    await updateBlock(compactId(intro.id), {
      paragraph: {
        rich_text: richText(
          "This page is the site backend. Edit the Settings / Navigation databases below, then trigger a deploy to publish changes.",
        ),
      },
    });
  }

  const jsonHeading = findHeadingBlock(blocks, { level: 2, includes: "Site config" });
  if (jsonHeading) {
    await updateBlock(compactId(jsonHeading.id), {
      heading_2: {
        rich_text: richText("Advanced config (JSON fallback)"),
      },
    });
  }

  // Ensure we don't create duplicates if this script is re-run.
  const hasSettingsDb = Boolean(findChildDatabaseBlock(blocks, "Site Settings"));
  const hasNavDb = Boolean(findChildDatabaseBlock(blocks, "Navigation"));
  const hasOverridesDb = Boolean(findChildDatabaseBlock(blocks, "Route Overrides"));

  // 1) Settings DB
  if (!hasSettingsDb) {
    await appendBlocks(adminPageId, [
      { object: "block", type: "divider", divider: {} },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText("Settings") },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText(
            "Edit these fields to configure site name, language, SEO, and the Notion content root. The build prefers these settings over the JSON block.",
          ),
        },
      },
    ]);

    const dbId = await createInlineDatabase({
      parentPageId: adminPageId,
      title: "Site Settings",
      properties: {
        Name: { title: {} },
        "Site Name": { rich_text: {} },
        Lang: {
          select: {
            options: [
              { name: "en", color: "gray" },
              { name: "zh", color: "brown" },
            ],
          },
        },
        "SEO Title": { rich_text: {} },
        "SEO Description": { rich_text: {} },
        Favicon: { rich_text: {} },
        "Root Page ID": { rich_text: {} },
        "Home Page ID": { rich_text: {} },
      },
    });

    await createDatabaseRow({
      databaseId: dbId,
      properties: {
        Name: { title: richText("Default") },
        "Site Name": { rich_text: richText(cfg.siteName) },
        Lang: { select: { name: cfg.lang || "en" } },
        "SEO Title": { rich_text: richText(cfg.seo?.title) },
        "SEO Description": { rich_text: richText(cfg.seo?.description) },
        Favicon: { rich_text: richText(cfg.seo?.favicon) },
        "Root Page ID": { rich_text: richText(cfg.content?.rootPageId) },
        "Home Page ID": { rich_text: richText(cfg.content?.homePageId) },
      },
    });
  }

  // 2) Navigation DB
  if (!hasNavDb) {
    await appendBlocks(adminPageId, [
      { object: "block", type: "divider", divider: {} },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText("Navigation") },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText(
            "Edit top nav + More dropdown. Group is `top` or `more`. Lower order appears first.",
          ),
        },
      },
    ]);

    const dbId = await createInlineDatabase({
      parentPageId: adminPageId,
      title: "Navigation",
      properties: {
        Label: { title: {} },
        Href: { rich_text: {} },
        Group: {
          select: {
            options: [
              { name: "top", color: "blue" },
              { name: "more", color: "purple" },
            ],
          },
        },
        Order: { number: { format: "number" } },
        Enabled: { checkbox: {} },
      },
    });

    const rows = [
      ...(cfg.nav?.top || []).map((it, idx) => ({ ...it, group: "top", order: idx + 1 })),
      ...(cfg.nav?.more || []).map((it, idx) => ({ ...it, group: "more", order: idx + 1 })),
    ];

    for (const it of rows) {
      await createDatabaseRow({
        databaseId: dbId,
        properties: {
          Label: { title: richText(it.label) },
          Href: { rich_text: richText(it.href) },
          Group: { select: { name: it.group } },
          Order: { number: it.order },
          Enabled: { checkbox: true },
        },
      });
    }
  }

  // 3) Route Overrides DB
  if (!hasOverridesDb) {
    await appendBlocks(adminPageId, [
      { object: "block", type: "divider", divider: {} },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText("Route Overrides (Optional)") },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText(
            "Force a specific Notion page ID to render at a custom route (e.g., `/chen`). Useful when the page title slug is too long.",
          ),
        },
      },
    ]);

    const dbId = await createInlineDatabase({
      parentPageId: adminPageId,
      title: "Route Overrides",
      properties: {
        Name: { title: {} },
        "Page ID": { rich_text: {} },
        "Route Path": { rich_text: {} },
        Enabled: { checkbox: {} },
      },
    });

    const overrides =
      cfg?.content?.routeOverrides && typeof cfg.content.routeOverrides === "object"
        ? cfg.content.routeOverrides
        : {};

    for (const [pageId, routePath] of Object.entries(overrides)) {
      await createDatabaseRow({
        databaseId: dbId,
        properties: {
          Name: { title: richText(String(routePath || pageId)) },
          "Page ID": { rich_text: richText(String(pageId)) },
          "Route Path": { rich_text: richText(String(routePath)) },
          Enabled: { checkbox: true },
        },
      });
    }
  }

  console.log("[provision:admin] Done.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});

