import { NextResponse, type NextRequest } from "next/server";

import { isSiteAdminAuthorized } from "@/lib/site-admin-auth";
import { compactId, slugify } from "@/lib/shared/route-utils.mjs";
import {
  getPropCheckbox,
  getPropNumber,
  getPropString,
  listBlockChildren,
  notionRequest,
  queryDatabase,
} from "@/lib/notion/api.mjs";

export const runtime = "nodejs";

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": "no-store" },
  });
}

async function requireAdmin(req: NextRequest) {
  const ok = await isSiteAdminAuthorized(req);
  if (!ok) {
    return { ok: false as const, res: json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}


async function findChildDatabases(blockId: string, maxDepth = 6): Promise<Array<{ id: string; title: string }>> {
  const out: Array<{ id: string; title: string }> = [];
  const blocks = await listBlockChildren(blockId);

  for (const b of blocks) {
    if (b?.type === "child_database") {
      out.push({ id: compactId(b.id), title: String(b?.child_database?.title || "") });
    }
  }

  if (maxDepth <= 0) return out;
  for (const b of blocks) {
    if (!b?.has_children) continue;
    out.push(...(await findChildDatabases(compactId(b.id), maxDepth - 1)));
  }
  return out;
}

function findDbByTitle(dbs: Array<{ id: string; title: string }>, title: string) {
  const want = slugify(title);
  return dbs.find((d) => slugify(d.title) === want) || null;
}

async function ensureSiteSettingsDbSchema(databaseId: string) {
  const id = compactId(databaseId);
  if (!id) return;

  const db = (await notionRequest(`databases/${id}`)) as unknown;
  const props =
    isObject(db) && isObject(db.properties) ? (db.properties as Record<string, unknown>) : {};
  const need: Record<string, unknown> = {};

  // Add missing properties lazily so /site-admin can run even if the admin DBs
  // were provisioned before we introduced new fields.
  if (!props["Google Analytics ID"]) need["Google Analytics ID"] = { rich_text: {} };
  if (!props["Content GitHub Users"]) need["Content GitHub Users"] = { rich_text: {} };

  if (Object.keys(need).length === 0) return;
  await notionRequest(`databases/${id}`, { method: "PATCH", body: { properties: need } });
}


function richText(content: string) {
  const c = String(content ?? "").trim();
  return c ? [{ type: "text", text: { content: c } }] : [];
}

type SiteSettings = {
  rowId: string;
  siteName: string;
  lang: string;
  seoTitle: string;
  seoDescription: string;
  favicon: string;
  googleAnalyticsId: string;
  contentGithubUsers: string;
  rootPageId: string;
  homePageId: string;
};

type NavItemRow = {
  rowId: string;
  label: string;
  href: string;
  group: "top" | "more";
  order: number;
  enabled: boolean;
};

async function loadConfigFromNotion(): Promise<{ settings: SiteSettings | null; nav: NavItemRow[] }> {
  const adminPageIdRaw = (process.env.NOTION_SITE_ADMIN_PAGE_ID || "").trim();
  const adminPageId = compactId(adminPageIdRaw);
  if (!adminPageId) throw new Error("Missing NOTION_SITE_ADMIN_PAGE_ID");

  const dbs = await findChildDatabases(adminPageId);
  const settingsDb = findDbByTitle(dbs, "Site Settings");
  const navDb = findDbByTitle(dbs, "Navigation");

  let settings: SiteSettings | null = null;
  if (settingsDb?.id) {
    await ensureSiteSettingsDbSchema(settingsDb.id);
    const rows = await queryDatabase(settingsDb.id);
    const row = rows[0] ?? null;
    if (row?.id) {
      settings = {
        rowId: compactId(row.id),
        siteName: getPropString(row, "Site Name"),
        lang: getPropString(row, "Lang") || "en",
        seoTitle: getPropString(row, "SEO Title"),
        seoDescription: getPropString(row, "SEO Description"),
        favicon: getPropString(row, "Favicon"),
        googleAnalyticsId: getPropString(row, "Google Analytics ID"),
        contentGithubUsers: getPropString(row, "Content GitHub Users"),
        rootPageId: getPropString(row, "Root Page ID"),
        homePageId: getPropString(row, "Home Page ID"),
      };
    }
  }

  const nav: NavItemRow[] = [];
  if (navDb?.id) {
    const rows = await queryDatabase(navDb.id);
    for (const row of rows) {
      if (!row?.id) continue;
      const groupRaw = (getPropString(row, "Group") || "more").toLowerCase();
      const group = (groupRaw === "top" ? "top" : "more") as "top" | "more";
      nav.push({
        rowId: compactId(row.id),
        label: getPropString(row, "Label") || getPropString(row, "Name"),
        href: getPropString(row, "Href"),
        group,
        order: getPropNumber(row, "Order") ?? 0,
        enabled: (getPropCheckbox(row, "Enabled") ?? true) === true,
      });
    }
    nav.sort((a, b) => {
      if (a.group !== b.group) return a.group === "top" ? -1 : 1;
      if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
      return a.label.localeCompare(b.label);
    });
  }

  return { settings, nav };
}

async function updateSiteSettings(rowId: string, patch: Partial<Omit<SiteSettings, "rowId">>) {
  const properties: Record<string, unknown> = {};
  if (patch.siteName !== undefined) properties["Site Name"] = { rich_text: richText(patch.siteName) };
  if (patch.lang !== undefined) properties["Lang"] = { select: { name: patch.lang || "en" } };
  if (patch.seoTitle !== undefined) properties["SEO Title"] = { rich_text: richText(patch.seoTitle) };
  if (patch.seoDescription !== undefined)
    properties["SEO Description"] = { rich_text: richText(patch.seoDescription) };
  if (patch.favicon !== undefined) properties["Favicon"] = { rich_text: richText(patch.favicon) };
  if (patch.googleAnalyticsId !== undefined)
    properties["Google Analytics ID"] = { rich_text: richText(patch.googleAnalyticsId) };
  if (patch.contentGithubUsers !== undefined)
    properties["Content GitHub Users"] = { rich_text: richText(patch.contentGithubUsers) };
  if (patch.rootPageId !== undefined) properties["Root Page ID"] = { rich_text: richText(patch.rootPageId) };
  if (patch.homePageId !== undefined) properties["Home Page ID"] = { rich_text: richText(patch.homePageId) };

  await notionRequest(`pages/${compactId(rowId)}`, { method: "PATCH", body: { properties } });
}

async function getNavDbId(): Promise<string> {
  const adminPageIdRaw = (process.env.NOTION_SITE_ADMIN_PAGE_ID || "").trim();
  const adminPageId = compactId(adminPageIdRaw);
  if (!adminPageId) throw new Error("Missing NOTION_SITE_ADMIN_PAGE_ID");
  const dbs = await findChildDatabases(adminPageId);
  const navDb = findDbByTitle(dbs, "Navigation");
  if (!navDb?.id) throw new Error("Missing Navigation database under Site Admin page");
  return navDb.id;
}

async function updateNavRow(rowId: string, patch: Partial<Omit<NavItemRow, "rowId">>) {
  const properties: Record<string, unknown> = {};
  if (patch.label !== undefined) properties["Label"] = { title: richText(patch.label) };
  if (patch.href !== undefined) properties["Href"] = { rich_text: richText(patch.href) };
  if (patch.group !== undefined)
    properties["Group"] = { select: { name: patch.group === "top" ? "top" : "more" } };
  if (patch.order !== undefined) properties["Order"] = { number: Number.isFinite(patch.order) ? patch.order : 0 };
  if (patch.enabled !== undefined) properties["Enabled"] = { checkbox: Boolean(patch.enabled) };
  await notionRequest(`pages/${compactId(rowId)}`, { method: "PATCH", body: { properties } });
}

async function createNavRow(input: Omit<NavItemRow, "rowId">) {
  const navDbId = await getNavDbId();
  const created: any = await notionRequest("pages", {
    method: "POST",
    body: {
      parent: { database_id: navDbId },
      properties: {
        Label: { title: richText(input.label) },
        Href: { rich_text: richText(input.href) },
        Group: { select: { name: input.group === "top" ? "top" : "more" } },
        Order: { number: Number.isFinite(input.order) ? input.order : 0 },
        Enabled: { checkbox: Boolean(input.enabled) },
      },
    },
  });
  return { rowId: compactId(created?.id || ""), ...input };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const data = await loadConfigFromNotion();
    return json({ ok: true, ...data });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ ok: false, error: "Bad request" }, { status: 400 });

  try {
    const kind = String((body as any).kind || "").trim();

    if (kind === "settings") {
      const rowId = compactId(String((body as any).rowId || ""));
      if (!rowId) return json({ ok: false, error: "Missing rowId" }, { status: 400 });
      const patch = (body as any).patch || {};
      await updateSiteSettings(rowId, patch);
      return json({ ok: true });
    }

    if (kind === "nav-update") {
      const rowId = compactId(String((body as any).rowId || ""));
      if (!rowId) return json({ ok: false, error: "Missing rowId" }, { status: 400 });
      const patch = (body as any).patch || {};
      await updateNavRow(rowId, patch);
      return json({ ok: true });
    }

    if (kind === "nav-create") {
      const input = (body as any).input || {};
      const created = await createNavRow({
        label: String(input.label || "").trim(),
        href: String(input.href || "").trim(),
        group: (String(input.group || "more").trim().toLowerCase() === "top" ? "top" : "more") as "top" | "more",
        order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
        enabled: Boolean(input.enabled ?? true),
      });
      return json({ ok: true, created });
    }

    return json({ ok: false, error: "Unknown kind" }, { status: 400 });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
