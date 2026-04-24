import "server-only";

import fs from "node:fs";
import path from "node:path";

import { logWarn } from "@/lib/server/error-log";

type SiteAdminAuditResult = "success" | "source_conflict" | "error";
type SiteAdminAuditAction =
  | "config.save"
  | "routes.override.save"
  | "routes.protected.save"
  | "deploy.trigger"
  | "posts.create"
  | "posts.update"
  | "posts.delete"
  | "pages.create"
  | "pages.update"
  | "pages.delete"
  | "assets.upload"
  | "assets.delete"
  | "publications.save"
  | "news.save";

export type SiteAdminAuditEvent = {
  action: SiteAdminAuditAction;
  result: SiteAdminAuditResult;
  actor: string;
  endpoint: string;
  method: string;
  status: number;
  code?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

type D1Config = {
  accountId: string;
  apiToken: string;
  databaseId: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readD1Config(): D1Config | null {
  const accountId = asString(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID);
  const apiToken = asString(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN);
  const databaseId = asString(
    process.env.SITE_ADMIN_AUDIT_D1_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID,
  );
  if (!accountId || !apiToken || !databaseId) return null;
  return { accountId, apiToken, databaseId };
}

function escapeMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeEvent(input: SiteAdminAuditEvent): Required<SiteAdminAuditEvent> & { at: string } {
  return {
    action: input.action,
    result: input.result,
    actor: asString(input.actor) || "unknown",
    endpoint: asString(input.endpoint) || "/api/site-admin/unknown",
    method: asString(input.method || "POST").toUpperCase() || "POST",
    status: Number.isFinite(Number(input.status)) ? Math.trunc(Number(input.status)) : 0,
    code: asString(input.code),
    message: escapeMessage(asString(input.message)),
    metadata:
      input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? input.metadata
        : {},
    at: new Date().toISOString(),
  };
}

async function d1Query(config: D1Config, sql: string, params: unknown[]): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    config.accountId,
  )}/d1/database/${encodeURIComponent(config.databaseId)}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
    cache: "no-store",
  }).catch(() => null);
  if (!(res instanceof Response) || !res.ok) {
    throw new Error("D1 query request failed");
  }
  const raw = (await res.json().catch(() => null)) as unknown;
  const payload = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (payload.success !== true) {
    throw new Error("D1 query returned success=false");
  }
}

async function writeToD1(config: D1Config, event: ReturnType<typeof normalizeEvent>): Promise<void> {
  await d1Query(
    config,
    `CREATE TABLE IF NOT EXISTS site_admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status INTEGER NOT NULL,
      code TEXT,
      message TEXT,
      metadata_json TEXT
    )`,
    [],
  );

  await d1Query(
    config,
    `INSERT INTO site_admin_audit_logs (
      at, actor, action, result, endpoint, method, status, code, message, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.at,
      event.actor,
      event.action,
      event.result,
      event.endpoint,
      event.method,
      event.status,
      event.code || null,
      event.message || null,
      JSON.stringify(event.metadata || {}),
    ],
  );
}

function localAuditLogPath(): string {
  return path.join(process.cwd(), "content", "generated", "site-admin-audit.log.jsonl");
}

function writeToLocalFile(event: ReturnType<typeof normalizeEvent>): void {
  const file = localAuditLogPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}

let d1FallbackWarned = false;

export function hasSiteAdminAuditD1Fallback(): boolean {
  return d1FallbackWarned;
}

export async function writeSiteAdminAuditLog(input: SiteAdminAuditEvent): Promise<void> {
  const event = normalizeEvent(input);
  const d1 = readD1Config();
  if (d1) {
    try {
      await writeToD1(d1, event);
      if (d1FallbackWarned) d1FallbackWarned = false;
      return;
    } catch (error: unknown) {
      if (!d1FallbackWarned) {
        d1FallbackWarned = true;
        logWarn({
          source: "site-admin-audit",
          message: "D1 write failed, falling back to local file sink",
          detail: error,
          meta: { action: event.action, result: event.result },
        });
      }
    }
  }
  try {
    writeToLocalFile(event);
  } catch (error: unknown) {
    logWarn({
      source: "site-admin-audit",
      message: "local file sink failed",
      detail: error,
    });
  }
}

