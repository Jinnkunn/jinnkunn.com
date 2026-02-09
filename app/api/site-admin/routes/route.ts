import { NextResponse, type NextRequest } from "next/server";

import { isSiteAdminAuthorized } from "@/lib/site-admin-auth";

export const runtime = "nodejs";

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": "no-store" },
  });
}

function compactId(idOrUrl: string): string {
  const s = String(idOrUrl || "").trim();
  const m =
    s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ||
    s.match(/[0-9a-f]{32}/i);
  if (!m) return "";
  return m[0].replace(/-/g, "").toLowerCase();
}

function slugify(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function normalizeRoutePath(p: string): string {
  const raw = String(p || "").trim();
  if (!raw) return "";
  let out = raw.startsWith("/") ? raw : `/${raw}`;
  out = out.replace(/\/+$/g, "");
  return out || "/";
}

async function requireAdmin(req: NextRequest) {
  const ok = await isSiteAdminAuthorized(req);
  if (!ok) return { ok: false as const, res: json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  return { ok: true as const };
}

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function notionRequest(
  pathname: string,
  opts: { method?: string; body?: unknown; searchParams?: Record<string, string> } = {},
) {
  const token = (process.env.NOTION_TOKEN || "").trim();
  if (!token) throw new Error("Missing NOTION_TOKEN");

  const url = new URL(`${NOTION_API}/${pathname}`);
  if (opts.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (res.ok) return json;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Notion API error ${res.status}: ${text.slice(0, 200)}`);
      await sleep(250 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`Notion API error ${res.status}: ${text.slice(0, 400)}`);
  }

  throw lastErr ?? new Error("Notion API request failed");
}

async function ensureProtectedDbSchema(databaseId: string) {
  if (!databaseId) return;
  const db: any = await notionRequest(`databases/${databaseId}`);
  const props = db?.properties && typeof db.properties === "object" ? db.properties : {};

  const patch: any = { properties: {} as any };
  if (!props["Page ID"]) patch.properties["Page ID"] = { rich_text: {} };
  if (!props["Auth"]) {
    patch.properties["Auth"] = {
      select: {
        options: [
          { name: "Password", color: "red" },
          { name: "GitHub", color: "blue" },
        ],
      },
    };
  }

  if (!Object.keys(patch.properties).length) return;
  await notionRequest(`databases/${databaseId}`, { method: "PATCH", body: patch });
}

async function listBlockChildren(blockId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined = undefined;
  for (;;) {
    const data: any = await notionRequest(`blocks/${blockId}/children`, {
      searchParams: cursor ? { start_cursor: cursor, page_size: "100" } : { page_size: "100" },
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.has_more) break;
    cursor = data?.next_cursor;
    if (!cursor) break;
  }
  return out;
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

async function queryDatabase(databaseId: string, opts?: { filter?: unknown }) {
  const out: any[] = [];
  let cursor: string | undefined = undefined;
  for (;;) {
    const data: any = await notionRequest(`databases/${databaseId}/query`, {
      method: "POST",
      body: {
        page_size: 100,
        start_cursor: cursor,
        filter: opts?.filter,
      },
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.has_more) break;
    cursor = data?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

function getPropString(page: any, name: string): string {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  const p = props[name];
  if (!p || typeof p !== "object") return "";
  if (p.type === "title") return (p.title ?? []).map((x: any) => x?.plain_text ?? "").join("").trim();
  if (p.type === "rich_text") return (p.rich_text ?? []).map((x: any) => x?.plain_text ?? "").join("").trim();
  if (p.type === "select") return String(p.select?.name ?? "").trim();
  return "";
}

function getPropCheckbox(page: any, name: string): boolean | null {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  const p = props[name];
  if (!p || typeof p !== "object") return null;
  if (p.type !== "checkbox") return null;
  return typeof p.checkbox === "boolean" ? p.checkbox : null;
}

async function upsertOverride({
  overridesDbId,
  notionPageId,
  pageId,
  routePath,
}: {
  overridesDbId: string;
  notionPageId: string;
  pageId: string;
  routePath: string;
}) {
  const normalized = normalizeRoutePath(routePath);
  if (!normalized) throw new Error("Missing routePath");

  // Find existing row by Page ID
  const rows = await queryDatabase(overridesDbId, {
    filter: {
      property: "Page ID",
      rich_text: { equals: pageId },
    },
  });
  const row = rows[0] ?? null;

  const properties = {
    Name: { title: [{ type: "text", text: { content: normalized } }] },
    "Page ID": { rich_text: [{ type: "text", text: { content: pageId } }] },
    "Route Path": { rich_text: [{ type: "text", text: { content: normalized } }] },
    Enabled: { checkbox: true },
  };

  if (row?.id) {
    await notionRequest(`pages/${compactId(row.id)}`, { method: "PATCH", body: { properties } });
    return { rowId: compactId(row.id), pageId, routePath: normalized, enabled: true };
  }

  const created: any = await notionRequest("pages", {
    method: "POST",
    body: {
      parent: { database_id: notionPageId },
      properties,
    },
  });
  return { rowId: compactId(created?.id || ""), pageId, routePath: normalized, enabled: true };
}

async function disableOverride({
  overridesDbId,
  pageId,
}: {
  overridesDbId: string;
  pageId: string;
}) {
  const rows = await queryDatabase(overridesDbId, {
    filter: { property: "Page ID", rich_text: { equals: pageId } },
  });
  const row = rows[0] ?? null;
  if (!row?.id) return { ok: true };
  await notionRequest(`pages/${compactId(row.id)}`, {
    method: "PATCH",
    body: { properties: { Enabled: { checkbox: false } } },
  });
  return { ok: true };
}

async function upsertProtected({
  protectedDbId,
  notionDbId,
  pageId,
  path,
  mode,
  password,
  auth,
}: {
  protectedDbId: string;
  notionDbId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  password: string;
  auth: "password" | "github";
}) {
  const normalized = normalizeRoutePath(path);
  if (!normalized) throw new Error("Missing path");
  const pid = compactId(pageId);
  if (!pid) throw new Error("Missing pageId");
  const pwd = String(password || "").trim();
  if (auth === "password" && !pwd) throw new Error("Missing password");

  // Prefer existing row by Page ID (stable under URL overrides). Fall back to Path for legacy rows.
  let row: any = null;
  try {
    const rowsByPid = await queryDatabase(protectedDbId, {
      filter: { property: "Page ID", rich_text: { equals: pid } },
    });
    row = rowsByPid[0] ?? null;
  } catch {
    // ignore
  }
  if (!row?.id) {
    const rowsByPath = await queryDatabase(protectedDbId, {
      filter: { property: "Path", rich_text: { equals: normalized } },
    });
    row = rowsByPath[0] ?? null;
  }

  const properties = {
    Name: { title: [{ type: "text", text: { content: normalized } }] },
    "Page ID": { rich_text: [{ type: "text", text: { content: pid } }] },
    Path: { rich_text: [{ type: "text", text: { content: normalized } }] },
    Mode: { select: { name: mode } },
    Auth: { select: { name: auth === "github" ? "GitHub" : "Password" } },
    Password: {
      rich_text: auth === "password" ? [{ type: "text", text: { content: pwd } }] : [],
    },
    Enabled: { checkbox: true },
  };

  if (row?.id) {
    await notionRequest(`pages/${compactId(row.id)}`, { method: "PATCH", body: { properties } });
    return { rowId: compactId(row.id), pageId: pid, path: normalized, mode, auth, enabled: true };
  }

  const created: any = await notionRequest("pages", {
    method: "POST",
    body: {
      parent: { database_id: notionDbId },
      properties,
    },
  });
  return {
    rowId: compactId(created?.id || ""),
    pageId: pid,
    path: normalized,
    mode,
    auth,
    enabled: true,
  };
}

async function disableProtected({
  protectedDbId,
  pageId,
  path,
}: {
  protectedDbId: string;
  pageId: string;
  path: string;
}) {
  const normalized = normalizeRoutePath(path);
  const pid = compactId(pageId);
  let row: any = null;
  if (pid) {
    try {
      const rowsByPid = await queryDatabase(protectedDbId, {
        filter: { property: "Page ID", rich_text: { equals: pid } },
      });
      row = rowsByPid[0] ?? null;
    } catch {
      // ignore
    }
  }
  if (!row?.id) {
    const rowsByPath = await queryDatabase(protectedDbId, {
      filter: { property: "Path", rich_text: { equals: normalized } },
    });
    row = rowsByPath[0] ?? null;
  }
  if (!row?.id) return { ok: true };
  await notionRequest(`pages/${compactId(row.id)}`, {
    method: "PATCH",
    body: { properties: { Enabled: { checkbox: false } } },
  });
  return { ok: true };
}

async function getAdminDbIds() {
  const adminPageIdRaw = (process.env.NOTION_SITE_ADMIN_PAGE_ID || "").trim();
  const adminPageId = compactId(adminPageIdRaw);
  if (!adminPageId) throw new Error("Missing NOTION_SITE_ADMIN_PAGE_ID");

  const dbs = await findChildDatabases(adminPageId);
  const overrides = findDbByTitle(dbs, "Route Overrides");
  const protectedDb = findDbByTitle(dbs, "Protected Routes");
  if (protectedDb?.id) await ensureProtectedDbSchema(protectedDb.id);
  return {
    adminPageId,
    overridesDbId: overrides?.id || "",
    protectedDbId: protectedDb?.id || "",
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const { adminPageId, overridesDbId, protectedDbId } = await getAdminDbIds();
    const overridesRows = overridesDbId ? await queryDatabase(overridesDbId) : [];
    const protectedRows = protectedDbId ? await queryDatabase(protectedDbId) : [];

    const overrides = overridesRows
      .map((row: any) => {
        const enabled = getPropCheckbox(row, "Enabled");
        if (enabled === false) return null;
        const pageId = compactId(getPropString(row, "Page ID"));
        const routePath = normalizeRoutePath(getPropString(row, "Route Path"));
        if (!pageId || !routePath) return null;
        return { rowId: compactId(row.id), pageId, routePath, enabled: true };
      })
      .filter(Boolean);

    const protectedRoutes = protectedRows
      .map((row: any) => {
        const enabled = getPropCheckbox(row, "Enabled");
        if (enabled === false) return null;
        const pageId = compactId(getPropString(row, "Page ID"));
        const path = normalizeRoutePath(getPropString(row, "Path"));
        const modeRaw = (getPropString(row, "Mode") || "exact").toLowerCase();
        const mode = modeRaw === "prefix" ? "prefix" : "exact";
        if (!path) return null;
        const authRaw = (getPropString(row, "Auth") || "").toLowerCase();
        const auth = authRaw === "github" ? "github" : "password";
        return { rowId: compactId(row.id), pageId, path, mode, auth, enabled: true };
      })
      .filter(Boolean);

    return json({
      ok: true,
      adminPageId,
      databases: { overridesDbId, protectedDbId },
      overrides,
      protectedRoutes,
    });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const { adminPageId, overridesDbId, protectedDbId } = await getAdminDbIds();

    const kind = String(body?.kind || "");
    if (kind === "override") {
      if (!overridesDbId) return json({ ok: false, error: "Missing Route Overrides DB" }, { status: 500 });
      const pageId = compactId(String(body?.pageId || ""));
      const routePath = String(body?.routePath || "").trim();
      if (!pageId) return json({ ok: false, error: "Missing pageId" }, { status: 400 });

      if (!routePath) {
        await disableOverride({ overridesDbId, pageId });
        return json({ ok: true });
      }

      const out = await upsertOverride({
        overridesDbId,
        notionPageId: overridesDbId, // database id
        pageId,
        routePath,
      });
      return json({ ok: true, override: out });
    }

    if (kind === "protected") {
      if (!protectedDbId) return json({ ok: false, error: "Missing Protected Routes DB" }, { status: 500 });
      const pageId = compactId(String(body?.pageId || ""));
      const path = String(body?.path || "").trim();
      // Product decision: protecting a page must protect its subtree (Super-like),
      // so we always store prefix rules.
      const mode: "prefix" = "prefix";
      const password = String(body?.password || "").trim();
      const authKindRaw = String(body?.auth || "password").trim().toLowerCase();
      const authKind: "public" | "password" | "github" =
        authKindRaw === "public" ? "public" : authKindRaw === "github" ? "github" : "password";
      if (!pageId) return json({ ok: false, error: "Missing pageId" }, { status: 400 });
      if (!path) return json({ ok: false, error: "Missing path" }, { status: 400 });

      // Public = disable any protection rule for this page.
      if (authKind === "public") {
        await disableProtected({ protectedDbId, pageId, path });
        return json({ ok: true });
      }

      // Disable password protection if password is blank.
      if (authKind === "password" && !password) {
        await disableProtected({ protectedDbId, pageId, path });
        return json({ ok: true });
      }

      // GitHub auth doesn't use a password; blank means "enable GitHub auth".
      if (authKind === "github" && password) {
        return json({ ok: false, error: "GitHub auth does not use a password" }, { status: 400 });
      }

      const out = await upsertProtected({
        protectedDbId,
        notionDbId: protectedDbId, // database id
        pageId,
        path,
        mode,
        password,
        auth: authKind,
      });
      return json({ ok: true, protected: out });
    }

    return json({ ok: false, error: "Unsupported kind" }, { status: 400 });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
