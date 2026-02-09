import fs from "node:fs";
import path from "node:path";
import { cache } from "react";

export type SyncMeta = {
  syncedAt: string;
  notionVersion?: string;
  adminPageId?: string;
  rootPageId?: string;
  homePageId?: string;
  homeTitle?: string;
  pages?: number;
  routes?: number;
  routeOverrides?: number;
  protectedRules?: number;
};

function readJsonFile(filePath: string): unknown | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findSyncMetaFile(): string | null {
  const candidates = [
    path.join(process.cwd(), "content", "generated", "sync-meta.json"),
    path.join(process.cwd(), "content", "sync-meta.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function asString(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() ? x : undefined;
}

function asNumber(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

function normalizeSyncMeta(input: unknown): SyncMeta | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const syncedAt = asString(o.syncedAt);
  if (!syncedAt) return null;

  return {
    syncedAt,
    notionVersion: asString(o.notionVersion),
    adminPageId: asString(o.adminPageId),
    rootPageId: asString(o.rootPageId),
    homePageId: asString(o.homePageId),
    homeTitle: asString(o.homeTitle),
    pages: asNumber(o.pages),
    routes: asNumber(o.routes),
    routeOverrides: asNumber(o.routeOverrides),
    protectedRules: asNumber(o.protectedRules),
  };
}

export const getSyncMeta = cache((): SyncMeta | null => {
  const file = findSyncMetaFile();
  if (!file) return null;
  return normalizeSyncMeta(readJsonFile(file));
});

