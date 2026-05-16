import {
  appendBlocks,
  createDatabaseRow,
  createInlineDatabase,
  findChildDatabaseBlock,
  richText,
} from "./provision-utils.mjs";

/** @typedef {import("../../lib/notion/types.ts").NotionBlock} NotionBlock */
/** @typedef {import("../../lib/shared/default-site-config.ts").DefaultSiteConfig} DefaultSiteConfig */

/**
 * @param {{ adminPageId: string, blocks: NotionBlock[], cfg: DefaultSiteConfig }} input
 */
export async function ensureNavigationDatabase({ adminPageId, blocks, cfg }) {
  if (findChildDatabaseBlock(blocks, "Navigation")) return;

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

  const top = Array.isArray(cfg?.nav?.top) ? cfg.nav.top : [];
  const more = Array.isArray(cfg?.nav?.more) ? cfg.nav.more : [];
  const rows = [
    ...top.map((it, idx) => ({ ...it, group: "top", order: idx + 1 })),
    ...more.map((it, idx) => ({ ...it, group: "more", order: idx + 1 })),
  ];

  for (const it of rows) {
    await createDatabaseRow({
      databaseId: dbId,
      properties: {
        Label: { title: richText(String(it?.label || "")) },
        Href: { rich_text: richText(String(it?.href || "")) },
        Group: { select: { name: it.group } },
        Order: { number: it.order },
        Enabled: { checkbox: true },
      },
    });
  }
}

/**
 * @param {{ adminPageId: string, blocks: NotionBlock[], cfg: DefaultSiteConfig }} input
 */
export async function ensureRouteOverridesDatabase({ adminPageId, blocks, cfg }) {
  if (findChildDatabaseBlock(blocks, "Route Overrides")) return;

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

/**
 * @param {{ adminPageId: string, blocks: NotionBlock[] }} input
 */
export async function ensureIncludedPagesDatabase({ adminPageId, blocks }) {
  if (findChildDatabaseBlock(blocks, "Included Pages")) return;

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

/**
 * @param {{ adminPageId: string, blocks: NotionBlock[] }} input
 */
export async function ensureProtectedRoutesDatabase({ adminPageId, blocks }) {
  if (findChildDatabaseBlock(blocks, "Protected Routes")) return;

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
