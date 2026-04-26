import "server-only";

import { assertValidPageSlug } from "@/lib/pages/slug";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";

const PAGE_TREE_REL_PATH = "content/page-tree.json";
const SCHEMA_VERSION = 1;

export type SiteAdminPageTreeData = {
  schemaVersion: number;
  slugs: string[];
};

function normalizeSlugList(raw: unknown): string[] {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { slugs?: unknown }).slugs
      : raw;
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (!slug || seen.has(slug)) continue;
    assertValidPageSlug(slug);
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

export function normalizePageTreeData(raw: unknown): SiteAdminPageTreeData {
  return {
    schemaVersion: SCHEMA_VERSION,
    slugs: normalizeSlugList(raw),
  };
}

export async function loadSiteAdminPageTreeData(): Promise<{
  data: SiteAdminPageTreeData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(PAGE_TREE_REL_PATH);
  if (!file) {
    return {
      data: { schemaVersion: SCHEMA_VERSION, slugs: [] },
      sourceVersion: { fileSha: "" },
    };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    parsed = null;
  }

  return {
    data: normalizePageTreeData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminPageTreeData(input: {
  slugs: string[];
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizePageTreeData({ slugs: input.slugs });
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: PAGE_TREE_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/page-tree.json",
  });
  return { fileSha: result.fileSha };
}
