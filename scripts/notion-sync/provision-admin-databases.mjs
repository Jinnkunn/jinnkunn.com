import { compactId } from "../../lib/shared/route-utils.mjs";
import {
  appendBlocks,
  createDatabaseRow,
  createInlineDatabase,
  findChildDatabaseBlock,
  findHeadingBlock,
  getDatabase,
  richText,
  updateBlock,
  updateDatabase,
} from "./provision-utils.mjs";

/** @typedef {import("../../lib/notion/types.ts").NotionBlock} NotionBlock */
/** @typedef {import("../../lib/shared/default-site-config.ts").DefaultSiteConfig} DefaultSiteConfig */

function githubUserListAsString(listOrString) {
  if (Array.isArray(listOrString)) return listOrString.join(", ");
  return String(listOrString || "").trim();
}

/**
 * Ensure the Site Settings inline DB exists and has the latest schema.
 * @param {{ adminPageId: string, blocks: NotionBlock[], cfg: DefaultSiteConfig }} input
 */
export async function ensureSettingsDatabase({ adminPageId, blocks, cfg }) {
  const hasSettingsDb = Boolean(findChildDatabaseBlock(blocks, "Site Settings"));
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
    return;
  }

  // Upgrade schema if Site Settings already exists.
  const dbBlock = findChildDatabaseBlock(blocks, "Site Settings");
  const dbId = dbBlock ? compactId(dbBlock.id) : "";
  if (!dbId) return;
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

/**
 * Ensure Deploy Logs DB exists and carries the latest schema + explanatory copy.
 * @param {{ adminPageId: string, blocks: NotionBlock[] }} input
 */
export async function ensureDeployLogsDatabase({ adminPageId, blocks }) {
  const hasDeployLogsDb = Boolean(findChildDatabaseBlock(blocks, "Deploy Logs"));

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
    return;
  }

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
  if (!deployLogsHeading) return;
  const idx = blocks.findIndex((b) => compactId(b.id) === compactId(deployLogsHeading.id));
  const after = idx >= 0 ? blocks.slice(idx + 1) : blocks;
  const paragraph = after.find((b) => b?.type === "paragraph");
  if (!paragraph) return;
  await updateBlock(compactId(paragraph.id), {
    paragraph: {
      rich_text: richText(
        "Each time you click Deploy now, the site writes a row here. With the Vercel webhook configured, the status will auto-update to Ready/Error when the deploy finishes.",
      ),
    },
  });
}
