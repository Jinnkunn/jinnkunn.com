import "server-only";

import { compactId } from "@/lib/shared/route-utils.mjs";
import { findChildDatabases, findDbByTitle } from "@/lib/notion/discovery";
import { notionRequest, queryDatabase } from "@/lib/notion/api";
import { isObject } from "@/lib/server/validate";

export type SiteAdminDatabaseInfo = {
  id: string;
  title: string;
};

export async function loadSiteAdminDatabases(): Promise<{
  adminPageId: string;
  databases: SiteAdminDatabaseInfo[];
}> {
  const adminPageIdRaw = (process.env.NOTION_SITE_ADMIN_PAGE_ID || "").trim();
  const adminPageId = compactId(adminPageIdRaw);
  if (!adminPageId) throw new Error("Missing NOTION_SITE_ADMIN_PAGE_ID");
  const databases = await findChildDatabases(adminPageId);
  return { adminPageId, databases };
}

export function findSiteAdminDatabaseIdByTitle(
  databases: SiteAdminDatabaseInfo[],
  title: string,
): string {
  return findDbByTitle(databases, title)?.id || "";
}

type RichTextLookup = {
  property: string;
  equals: string;
};

type LookupOptions = {
  ignoreLookupErrors?: boolean;
};

export type NotionRow = Record<string, unknown> & { id?: string };

export function notionRowId(row: { id?: unknown } | null | undefined): string {
  return compactId(String(row?.id || ""));
}

export async function patchPageProperties(
  pageId: string,
  properties: Record<string, unknown>,
) {
  const id = compactId(pageId);
  if (!id) return;
  await notionRequest(`pages/${id}`, { method: "PATCH", body: { properties } });
}

export async function createDatabaseRow(
  databaseId: string,
  properties: Record<string, unknown>,
): Promise<string> {
  const id = compactId(databaseId);
  if (!id) return "";
  const created = (await notionRequest("pages", {
    method: "POST",
    body: {
      parent: { database_id: id },
      properties,
    },
  })) as unknown;
  return notionRowId(isObject(created) ? (created as { id?: unknown }) : null);
}

export async function getSiteAdminDatabaseIdByTitle(title: string): Promise<string> {
  const { databases } = await loadSiteAdminDatabases();
  return findSiteAdminDatabaseIdByTitle(databases, title);
}

export async function findFirstRowByRichTextLookups(
  databaseId: string,
  lookups: RichTextLookup[],
  options?: LookupOptions,
): Promise<NotionRow | null> {
  for (const lookup of lookups) {
    const equals = String(lookup.equals || "").trim();
    if (!equals) continue;
    try {
      const rows = await queryDatabase(databaseId, {
        filter: {
          property: lookup.property,
          rich_text: { equals },
        },
      });
      const row = rows[0] ?? null;
      if (isObject(row)) return row as NotionRow;
    } catch (error) {
      if (!options?.ignoreLookupErrors) throw error;
    }
  }
  return null;
}

export async function findFirstRowByFilter(
  databaseId: string,
  filter: unknown,
  sorts?: unknown,
): Promise<NotionRow | null> {
  const rows = await queryDatabase(databaseId, {
    filter,
    ...(sorts === undefined ? {} : { sorts }),
  });
  const row = rows[0] ?? null;
  return isObject(row) ? (row as NotionRow) : null;
}

export async function upsertDatabaseRowByRichTextLookups(input: {
  databaseId: string;
  lookups: RichTextLookup[];
  properties: Record<string, unknown>;
  options?: LookupOptions;
}): Promise<{ rowId: string; created: boolean }> {
  const row = await findFirstRowByRichTextLookups(
    input.databaseId,
    input.lookups,
    input.options,
  );
  const rowId = notionRowId(row);
  if (rowId) {
    await patchPageProperties(rowId, input.properties);
    return { rowId, created: false };
  }
  const createdId = await createDatabaseRow(input.databaseId, input.properties);
  return { rowId: createdId, created: true };
}

export async function disableDatabaseRowByRichTextLookups(input: {
  databaseId: string;
  lookups: RichTextLookup[];
  disableProperties?: Record<string, unknown>;
  options?: LookupOptions;
}): Promise<{ disabled: boolean }> {
  const row = await findFirstRowByRichTextLookups(
    input.databaseId,
    input.lookups,
    input.options,
  );
  const rowId = notionRowId(row);
  if (!rowId) return { disabled: false };
  await patchPageProperties(
    rowId,
    input.disableProperties || { Enabled: { checkbox: false } },
  );
  return { disabled: true };
}

export async function ensureDatabaseProperties(
  databaseId: string,
  required: Record<string, unknown>,
) {
  const id = compactId(databaseId);
  if (!id) return;

  const db = (await notionRequest(`databases/${id}`)) as unknown;
  const props = isObject(db) && isObject(db.properties)
    ? (db.properties as Record<string, unknown>)
    : {};

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(required)) {
    if (!props[key]) patch[key] = value;
  }
  if (!Object.keys(patch).length) return;

  await notionRequest(`databases/${id}`, {
    method: "PATCH",
    body: { properties: patch },
  });
}
