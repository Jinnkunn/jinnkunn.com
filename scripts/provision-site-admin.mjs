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

function richTextLink(label, url) {
  const l = String(label ?? "").trim();
  const u = String(url ?? "").trim();
  if (!l || !u) return richText(l);
  return [{ type: "text", text: { content: l, link: { url: u } } }];
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

async function updateDatabase(databaseId, patch) {
  await notionRequest(`databases/${databaseId}`, { method: "PATCH", body: patch });
}

async function archiveBlock(blockId) {
  await updateBlock(blockId, { archived: true });
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
      return { blockId: compactId(b.id), json: t };
    } catch {
      // keep looking
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

function getTextFromBlock(block) {
  if (!block || typeof block !== "object") return "";
  const type = block.type;
  if (!type) return "";
  const rt = block?.[type]?.rich_text ?? [];
  if (!Array.isArray(rt)) return "";
  return rt.map((x) => x?.plain_text ?? "").join("").trim();
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

  // Cleanup: remove older helper copy that is now redundant with the Settings DB.
  const contentRoot = findTextBlock(blocks, { type: "paragraph", includes: "content root page:" });
  if (contentRoot) await archiveBlock(compactId(contentRoot.id));

  // Update copy to point people at the databases first.
  const intro = findTextBlock(blocks, { type: "paragraph", includes: "site backend" });
  if (intro) {
    await updateBlock(compactId(intro.id), {
      paragraph: {
        rich_text: richText(
          "This page is the site backend. Edit the Settings / Navigation databases below, then trigger a deploy to publish changes. Pages are discovered automatically from the configured Notion root (including database entries like Blog posts).",
        ),
      },
    });
  }

  // Hide the JSON fallback by moving it into a toggle at the bottom of the page.
  // This keeps the page feeling like a real backend (Super.so style) while still
  // preserving the fallback for local dev / emergency recovery.
  const hasAdvancedToggle = blocks.some((b) => {
    if (b?.type !== "toggle") return false;
    return getTextFromBlock(b).toLowerCase().includes("advanced config");
  });

  const jsonHeading =
    findHeadingBlock(blocks, { level: 2, includes: "Advanced config" }) ||
    findHeadingBlock(blocks, { level: 2, includes: "Site config" });

  if (!hasAdvancedToggle && jsonHeading) {
    const idx = blocks.findIndex((b) => compactId(b.id) === compactId(jsonHeading.id));
    let codeBlock = null;
    for (let i = idx + 1; i < blocks.length && i < idx + 10; i++) {
      const b = blocks[i];
      if (b?.type === "code") {
        const rt = b?.code?.rich_text ?? [];
        const text = rt.map((x) => x?.plain_text ?? "").join("");
        const t = text.trim();
        if (t.startsWith("{")) {
          try {
            JSON.parse(t);
            codeBlock = b;
          } catch {
            // not json
          }
        }
        break;
      }
      if (b?.type?.startsWith("heading_") || b?.type === "child_database") break;
    }

    // Only migrate if we actually found a valid JSON code block.
    const jsonText =
      codeBlock?.type === "code"
        ? (codeBlock.code?.rich_text ?? []).map((x) => x?.plain_text ?? "").join("").trim()
        : "";

    if (jsonText) {
      // Append at the bottom so the main controls stay focused.
      await appendBlocks(adminPageId, [
        { object: "block", type: "divider", divider: {} },
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: richText("Advanced config (JSON fallback)"),
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: richText(
                    "Prefer the Settings / Navigation databases above. This JSON is a fallback that the build can read if the databases are missing.",
                  ),
                },
              },
              {
                object: "block",
                type: "code",
                code: {
                  rich_text: richText(jsonText),
                  language: "json",
                },
              },
            ],
          },
        },
      ]);

      // Archive the old divider above the heading, if it exists (it's now redundant).
      if (idx > 0 && blocks[idx - 1]?.type === "divider") {
        await archiveBlock(compactId(blocks[idx - 1].id));
      }

      await archiveBlock(compactId(jsonHeading.id));
      if (codeBlock) await archiveBlock(compactId(codeBlock.id));
    }
  } else if (jsonHeading) {
    // If the toggle exists, any remaining heading is redundant.
    await archiveBlock(compactId(jsonHeading.id));
  }

  // Ensure we don't create duplicates if this script is re-run.
  const hasSettingsDb = Boolean(findChildDatabaseBlock(blocks, "Site Settings"));
  const hasNavDb = Boolean(findChildDatabaseBlock(blocks, "Navigation"));
  const hasOverridesDb = Boolean(findChildDatabaseBlock(blocks, "Route Overrides"));
  const hasIncludedPagesDb = Boolean(findChildDatabaseBlock(blocks, "Included Pages"));
  const hasProtectedDb = Boolean(findChildDatabaseBlock(blocks, "Protected Routes"));
  const hasDeployLogsDb = Boolean(findChildDatabaseBlock(blocks, "Deploy Logs"));

  // 0) Deploy section (best-effort). Notion doesn't support real "buttons", but a link works.
  const deployHeading = findHeadingBlock(blocks, { level: 2, includes: "Deploy" });
  {
    const deployBase =
      String(process.env.DEPLOY_BASE_URL || "").trim().replace(/\/+$/, "") ||
      "https://jinnkunn-com.vercel.app";
    const deployTokenRaw = String(process.env.DEPLOY_TOKEN || "").trim();
    const deployToken =
      deployTokenRaw && !["undefined", "null"].includes(deployTokenRaw.toLowerCase())
        ? deployTokenRaw
        : "";
    const deployUrl = deployToken
      ? `${deployBase}/api/deploy?token=${encodeURIComponent(deployToken)}`
      : `${deployBase}/api/deploy?token=YOUR_DEPLOY_TOKEN`;
    const shouldUpdateDeployLink = Boolean(deployToken);

    if (!deployHeading) {
      await appendBlocks(adminPageId, [
        { object: "block", type: "divider", divider: {} },
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: richText("Deploy") },
        },
        {
          object: "block",
          type: "callout",
          callout: {
            icon: { type: "emoji", emoji: "🚀" },
            color: "gray_background",
            rich_text: [
              ...richText("Click to deploy: "),
              ...richTextLink("Deploy now", deployUrl),
            ],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: richText(
              "If this link returns Unauthorized, set DEPLOY_TOKEN on Vercel and re-run this provision script with the same DEPLOY_TOKEN to update the link.",
            ),
          },
        },
      ]);
    } else {
      // Update existing deploy link if the section already exists.
      const idx = blocks.findIndex((b) => compactId(b.id) === compactId(deployHeading.id));
      const after = idx >= 0 ? blocks.slice(idx + 1) : blocks;
      const callout = after.find((b) => b?.type === "callout");
      if (callout && shouldUpdateDeployLink) {
        await updateBlock(compactId(callout.id), {
          callout: {
            ...(callout.callout || {}),
            rich_text: [
              ...richText("Click to deploy: "),
              ...richTextLink("Deploy now", deployUrl),
            ],
          },
        });
      }

      const tipText =
        "If this link returns Unauthorized, set DEPLOY_TOKEN on Vercel and re-run this provision script with the same DEPLOY_TOKEN to update the link.";

      // Update older tip copy (we've used a few variants across iterations).
      const tip =
        findTextBlock(after, { type: "paragraph", includes: "Unauthorized" }) ||
        findTextBlock(after, { type: "paragraph", includes: "notion button" }) ||
        findTextBlock(after, { type: "paragraph", includes: "deploy url" }) ||
        findTextBlock(after, { type: "paragraph", includes: "tip:" });
      if (tip) await updateBlock(compactId(tip.id), { paragraph: { rich_text: richText(tipText) } });
    }
  }

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

  // 1.5) Deploy Logs DB (Optional but recommended)
  if (!hasDeployLogsDb) {
    await appendBlocks(adminPageId, [
      { object: "block", type: "divider", divider: {} },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText("Deploy Logs") },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText(
            "Each time you click Deploy now, the site writes a row here. With the Vercel webhook configured, the status will auto-update to Ready/Error when the deploy finishes.",
          ),
        },
      },
    ]);

    await createInlineDatabase({
      parentPageId: adminPageId,
      title: "Deploy Logs",
      properties: {
        Name: { title: {} },
        "Triggered At": { date: {} },
        Result: {
          select: {
            options: [
              { name: "Triggered", color: "green" },
              { name: "Building", color: "yellow" },
              { name: "Ready", color: "blue" },
              { name: "Error", color: "red" },
              { name: "Canceled", color: "gray" },
              { name: "Failed", color: "red" },
            ],
          },
        },
        Target: {
          select: {
            options: [
              { name: "production", color: "green" },
              { name: "preview", color: "gray" },
              { name: "staging", color: "orange" },
            ],
          },
        },
        "Deployment ID": { rich_text: {} },
        Deployment: { url: {} },
        Dashboard: { url: {} },
        "Last Event": { rich_text: {} },
        "HTTP Status": { number: { format: "number" } },
        Request: { url: {} },
        Message: { rich_text: {} },
      },
    });
  } else {
    // Upgrade schema if Deploy Logs already exists.
    const dbBlock = findChildDatabaseBlock(blocks, "Deploy Logs");
    if (dbBlock) {
      const dbId = compactId(dbBlock.id);
      await updateDatabase(dbId, {
        properties: {
          Result: {
            select: {
              options: [
                { name: "Triggered", color: "green" },
                { name: "Building", color: "yellow" },
                { name: "Ready", color: "blue" },
                { name: "Error", color: "red" },
                { name: "Canceled", color: "gray" },
                { name: "Failed", color: "red" },
              ],
            },
          },
          Target: {
            select: {
              options: [
                { name: "production", color: "green" },
                { name: "preview", color: "gray" },
                { name: "staging", color: "orange" },
              ],
            },
          },
          "Deployment ID": { rich_text: {} },
          Deployment: { url: {} },
          Dashboard: { url: {} },
          "Last Event": { rich_text: {} },
        },
      });
    }

    // Refresh the descriptive paragraph copy (avoid older variants lingering).
    const deployLogsHeading = findHeadingBlock(blocks, { level: 2, includes: "Deploy Logs" });
    if (deployLogsHeading) {
      const idx = blocks.findIndex((b) => compactId(b.id) === compactId(deployLogsHeading.id));
      const after = idx >= 0 ? blocks.slice(idx + 1) : blocks;
      const p = after.find((b) => b?.type === "paragraph");
      if (p) {
        await updateBlock(compactId(p.id), {
          paragraph: {
            rich_text: richText(
              "Each time you click Deploy now, the site writes a row here. With the Vercel webhook configured, the status will auto-update to Ready/Error when the deploy finishes.",
            ),
          },
        });
      }
    }
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

  // 3.5) Included Pages (Optional)
  // Some pages may not be discovered as descendants (e.g., moved pages, pages living outside the root,
  // or blocks nested in complex layouts if discovery ever misses them). This database lets you
  // explicitly include additional Notion pages in the site tree.
  if (!hasIncludedPagesDb) {
    await appendBlocks(adminPageId, [
      { object: "block", type: "divider", divider: {} },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText("Included Pages (Optional)") },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText(
            "Explicitly include extra Notion pages in the site (in addition to the pages discovered under the configured Root Page). Provide the Page ID (or URL). Optionally set a Route Path to force the URL.",
          ),
        },
      },
    ]);

    const dbId = await createInlineDatabase({
      parentPageId: adminPageId,
      title: "Included Pages",
      properties: {
        Name: { title: {} },
        Enabled: { checkbox: {} },
        "Page ID": { rich_text: {} },
        "Route Path": { rich_text: {} },
        Order: { number: { format: "number" } },
        Note: { rich_text: {} },
      },
    });

    // Seed a disabled example row to make the UX obvious.
    await createDatabaseRow({
      databaseId: dbId,
      properties: {
        Name: { title: richText("Example (disable or delete)") },
        Enabled: { checkbox: false },
        "Page ID": { rich_text: richText("PASTE_NOTION_PAGE_ID_OR_URL") },
        "Route Path": { rich_text: richText("/example") },
        Order: { number: 999 },
        Note: { rich_text: richText("Optional: force route path, otherwise slug is derived from title.") },
      },
    });
  }

  // 4) Protected Routes (Optional)
  if (!hasProtectedDb) {
    await appendBlocks(adminPageId, [
      { object: "block", type: "divider", divider: {} },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText("Protected Routes (Optional)") },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText(
            "Add paths that should require a password. This is a lightweight access control feature (not intended for high-stakes security).",
          ),
        },
      },
    ]);

    await createInlineDatabase({
      parentPageId: adminPageId,
      title: "Protected Routes",
      properties: {
        Name: { title: {} },
        Path: { rich_text: {} },
        Mode: {
          select: {
            options: [
              { name: "exact", color: "gray" },
              { name: "prefix", color: "brown" },
            ],
          },
        },
        Password: { rich_text: {} },
        Enabled: { checkbox: {} },
      },
    });
  }

  // 5) Cleanup: archive obvious empty paragraphs that accumulate from manual edits.
  // (Keep this conservative; we only remove blocks that are truly empty.)
  for (const b of blocks) {
    if (b?.type !== "paragraph") continue;
    const t = getTextFromBlock(b);
    if (t) continue;
    try {
      await archiveBlock(compactId(b.id));
    } catch {
      // ignore cleanup errors
    }
  }

  console.log("[provision:admin] Done.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
