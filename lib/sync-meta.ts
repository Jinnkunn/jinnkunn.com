import { readContentJson } from "@/lib/server/content-json";

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

export function getSyncMeta(): SyncMeta | null {
  const parsed = readContentJson("sync-meta.json");
  if (!parsed) return null;
  return normalizeSyncMeta(parsed);
}
