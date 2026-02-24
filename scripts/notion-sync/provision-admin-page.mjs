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
    "https://jinnkunn-com.vercel.app";
  const deployUrl = `${deployBase}/site-admin`;

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
            ...richText("Open admin deploy panel: "),
            ...richTextLink("Site Admin", deployUrl),
          ],
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText(
            "Deploy API now requires signed POST headers (x-deploy-ts + x-deploy-signature). Use Site Admin for one-click deploy.",
          ),
        },
      },
    ]);
    return;
  }

  // Update existing deploy link if the section already exists.
  const idx = blocks.findIndex((b) => compactId(b.id) === compactId(deployHeading.id));
  const after = idx >= 0 ? blocks.slice(idx + 1) : blocks;
  const callout = after.find((b) => b?.type === "callout");
  if (callout) {
    await updateBlock(compactId(callout.id), {
      callout: {
        ...(callout.callout || {}),
        rich_text: [
          ...richText("Open admin deploy panel: "),
          ...richTextLink("Site Admin", deployUrl),
        ],
      },
    });
  }

  const tipText =
    "Deploy API now requires signed POST headers (x-deploy-ts + x-deploy-signature). Use Site Admin for one-click deploy.";

  // Update older tip copy (we've used a few variants across iterations).
  const tip =
    findTextBlock(after, { type: "paragraph", includes: "Unauthorized" }) ||
    findTextBlock(after, { type: "paragraph", includes: "notion button" }) ||
    findTextBlock(after, { type: "paragraph", includes: "deploy url" }) ||
    findTextBlock(after, { type: "paragraph", includes: "tip:" });
  if (tip) await updateBlock(compactId(tip.id), { paragraph: { rich_text: richText(tipText) } });
}
