import { compactId } from "../../lib/shared/route-utils.mjs";
import {
  appendBlocks,
  archiveBlock,
  findHeadingBlock,
  findTextBlock,
  getTextFromBlock,
  richText,
  richTextLink,
  updateBlock,
} from "./provision-utils.mjs";

/** @typedef {import("../../lib/notion/types.ts").NotionBlock} NotionBlock */

/**
 * Normalize the top explanatory copy and migrate legacy JSON config heading/code
 * into a collapsed "Advanced config" toggle at the bottom.
 * @param {{ adminPageId: string, blocks: NotionBlock[] }} input
 */
export async function syncAdminPageIntroAndFallback({ adminPageId, blocks }) {
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
}

/**
 * Ensure the Deploy section exists and points to /site-admin.
 * The secure deploy API requires signed POST headers, so it cannot be a plain
 * Notion link button.
 * @param {{ adminPageId: string, blocks: NotionBlock[] }} input
 */
export async function ensureDeploySection({ adminPageId, blocks }) {
  const deployHeading = findHeadingBlock(blocks, { level: 2, includes: "Deploy" });
  const deployBase =
    String(process.env.DEPLOY_BASE_URL || "").trim().replace(/\/+$/, "") ||
    "https://jinkunchen.com";
  const deployUrl = `${deployBase}/site-admin`;
  const deployCalloutBlock = {
    object: "block",
    type: "callout",
    callout: {
      icon: { type: "emoji", emoji: "🚀" },
      color: "gray_background",
      rich_text: [
        ...richText("Open deploy panel: "),
        ...richTextLink("Site Admin", deployUrl),
      ],
    },
  };
  const deployTipText =
    "Deploy API now requires signed POST headers (x-deploy-ts + x-deploy-signature). Use Site Admin for one-click deploy.";
  const deployTipBlock = {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(deployTipText),
    },
  };

  const legacyDeployUrls = [
    "/api/deploy",
    "/api/site-admin/deploy",
  ];

  const richTextContainsLegacyDeployUrl = (items) =>
    Array.isArray(items) &&
    items.some((item) => {
      const url = String(item?.text?.link?.url || item?.href || "").trim();
      return legacyDeployUrls.some((needle) => url.includes(needle));
    });

  const isLegacyDeployLinkBlock = (block) => {
    if (!block || typeof block !== "object") return false;
    if (block.archived) return false;
    const type = String(block.type || "");
    if (type === "bookmark") {
      const url = String(block.bookmark?.url || "").trim();
      return legacyDeployUrls.some((needle) => url.includes(needle));
    }
    if (type === "link_preview") {
      const url = String(block.link_preview?.url || "").trim();
      return legacyDeployUrls.some((needle) => url.includes(needle));
    }
    const richText = block?.[type]?.rich_text ?? [];
    return richTextContainsLegacyDeployUrl(richText);
  };

  for (const block of blocks) {
    if (!isLegacyDeployLinkBlock(block)) continue;
    try {
      await archiveBlock(compactId(block.id));
    } catch {
      // Best-effort cleanup only.
    }
  }

  if (!deployHeading) {
    await appendBlocks(adminPageId, [
      { object: "block", type: "divider", divider: {} },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText("Deploy") },
      },
      deployCalloutBlock,
      deployTipBlock,
    ]);
    return;
  }

  // Update existing deploy link if the section already exists.
  const idx = blocks.findIndex((b) => compactId(b.id) === compactId(deployHeading.id));
  const sectionAfter = [];
  for (const block of idx >= 0 ? blocks.slice(idx + 1) : blocks) {
    if (block?.archived) continue;
    if (String(block?.type || "").startsWith("heading_")) break;
    sectionAfter.push(block);
  }

  const callout = sectionAfter.find((b) => b?.type === "callout");
  if (callout) {
    await updateBlock(compactId(callout.id), {
      callout: {
        ...(callout.callout || {}),
        rich_text: [
          ...richText("Open deploy panel: "),
          ...richTextLink("Site Admin", deployUrl),
        ],
      },
    });
  }

  // Update older tip copy (we've used a few variants across iterations).
  const tip =
    findTextBlock(sectionAfter, { type: "paragraph", includes: "Unauthorized" }) ||
    findTextBlock(sectionAfter, { type: "paragraph", includes: "notion button" }) ||
    findTextBlock(sectionAfter, { type: "paragraph", includes: "deploy url" }) ||
    findTextBlock(sectionAfter, { type: "paragraph", includes: "tip:" }) ||
    findTextBlock(sectionAfter, { type: "paragraph", includes: "signed POST headers" });
  if (tip) {
    await updateBlock(compactId(tip.id), { paragraph: { rich_text: richText(deployTipText) } });
  }

  if (!callout) {
    const children = tip ? [deployCalloutBlock] : [deployCalloutBlock, deployTipBlock];
    await appendBlocks(adminPageId, children, { after: compactId(deployHeading.id) });
  } else if (!tip) {
    await appendBlocks(adminPageId, [deployTipBlock], { after: compactId(callout.id) });
  }
}
