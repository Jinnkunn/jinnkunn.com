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
import { archiveBlock, getTextFromBlock } from "./notion-sync/provision-utils.mjs";
import {
  ensureDeploySection,
  syncAdminPageIntroAndFallback,
} from "./notion-sync/provision-admin-page.mjs";
import {
  ensureDeployLogsDatabase,
  ensureSettingsDatabase,
} from "./notion-sync/provision-admin-databases.mjs";
import {
  ensureIncludedPagesDatabase,
  ensureNavigationDatabase,
  ensureProtectedRoutesDatabase,
  ensureRouteOverridesDatabase,
} from "./notion-sync/provision-admin-routes.mjs";

const DEFAULT_CONFIG = DEFAULT_SITE_CONFIG;

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

  // 0) Deploy section (best-effort). Notion doesn't support real "buttons", but a link works.
  await ensureDeploySection({ adminPageId, blocks });

  // 1) Settings DB
  await ensureSettingsDatabase({ adminPageId, blocks, cfg });

  // 1.5) Deploy Logs DB (Optional but recommended)
  await ensureDeployLogsDatabase({ adminPageId, blocks });

  // 2) Navigation DB
  await ensureNavigationDatabase({ adminPageId, blocks, cfg });

  // 3) Route Overrides DB
  await ensureRouteOverridesDatabase({ adminPageId, blocks, cfg });

  // 3.5) Included Pages (Optional)
  await ensureIncludedPagesDatabase({ adminPageId, blocks });

  // 4) Protected Routes (Optional)
  await ensureProtectedRoutesDatabase({ adminPageId, blocks });

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
