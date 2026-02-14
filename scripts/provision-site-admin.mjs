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

import { listBlockChildren, findFirstJsonCodeBlock } from "../lib/notion/index.mjs";
import { compactId } from "../lib/shared/route-utils.mjs";
import { DEFAULT_SITE_CONFIG } from "../lib/shared/default-site-config.mjs";
import { deepMerge } from "../lib/shared/object-utils.mjs";
import {
  appendBlocks,
  archiveBlock,
  createDatabaseRow,
  createInlineDatabase,
  findChildDatabaseBlock,
  findHeadingBlock,
  getDatabase,
  richText,
  updateBlock,
  updateDatabase,
} from "./notion-sync/provision-utils.mjs";
import {
  ensureDeploySection,
  syncAdminPageIntroAndFallback,
} from "./notion-sync/provision-admin-page.mjs";

const DEFAULT_CONFIG = DEFAULT_SITE_CONFIG;

function githubUserListAsString(listOrString) {
  if (Array.isArray(listOrString)) return listOrString.join(", ");
  return String(listOrString || "").trim();
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

  await syncAdminPageIntroAndFallback({ adminPageId, blocks });

  // Ensure we don't create duplicates if this script is re-run.
  const hasSettingsDb = Boolean(findChildDatabaseBlock(blocks, "Site Settings"));
  const hasNavDb = Boolean(findChildDatabaseBlock(blocks, "Navigation"));
  const hasOverridesDb = Boolean(findChildDatabaseBlock(blocks, "Route Overrides"));
  const hasIncludedPagesDb = Boolean(findChildDatabaseBlock(blocks, "Included Pages"));
  const hasProtectedDb = Boolean(findChildDatabaseBlock(blocks, "Protected Routes"));
  const hasDeployLogsDb = Boolean(findChildDatabaseBlock(blocks, "Deploy Logs"));

  // 0) Deploy section (best-effort). Notion doesn't support real "buttons", but a link works.
  await ensureDeploySection({ adminPageId, blocks });

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
        "Google Analytics ID": { rich_text: {} },
        "Content GitHub Users": { rich_text: {} },
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
        "Google Analytics ID": {
          rich_text: richText(cfg.integrations?.googleAnalyticsId || ""),
        },
        "Content GitHub Users": {
          rich_text: richText(githubUserListAsString(cfg.security?.contentGithubUsers)),
        },
        "Root Page ID": { rich_text: richText(cfg.content?.rootPageId) },
        "Home Page ID": { rich_text: richText(cfg.content?.homePageId) },
      },
    });
  } else {
    // Upgrade schema if Site Settings already exists.
    const dbBlock = findChildDatabaseBlock(blocks, "Site Settings");
    const dbId = dbBlock ? compactId(dbBlock.id) : "";
    if (dbId) {
      const db = await getDatabase(dbId).catch(() => null);
      const props = db?.properties && typeof db.properties === "object" ? db.properties : {};
      if (!props["Google Analytics ID"]) {
        await updateDatabase(dbId, {
          properties: {
            "Google Analytics ID": { rich_text: {} },
          },
        });
      }
      if (!props["Content GitHub Users"]) {
        await updateDatabase(dbId, {
          properties: {
            "Content GitHub Users": { rich_text: {} },
          },
        });
      }
    }
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
