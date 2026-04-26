import type { SiteAdminHomeData } from "./api-types";

const SCHEMA_VERSION = 4;

const EMPTY_DATA: SiteAdminHomeData = {
  schemaVersion: SCHEMA_VERSION,
  title: "Hi there!",
};

function readRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function readString(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** Coerce arbitrary input (a parsed home.json blob, an HTTP request
 * body) into a typed SiteAdminHomeData. Drops blank / whitespace-only
 * bodyMdx so an empty editor doesn't pin the public render to an empty
 * MDX body. The legacy section schema is silently ignored — older
 * home.json files still load, just without their (now-deleted)
 * sections. */
export function normalizeHomeData(raw: unknown): SiteAdminHomeData {
  const r = readRecord(raw);
  if (!r) return emptyHomeData();
  const bodyMdx = typeof r.bodyMdx === "string" ? r.bodyMdx : undefined;
  return {
    schemaVersion: SCHEMA_VERSION,
    title: readString(r.title).trim() || EMPTY_DATA.title,
    bodyMdx: bodyMdx && bodyMdx.trim() ? bodyMdx : undefined,
  };
}

export function emptyHomeData(): SiteAdminHomeData {
  return { ...EMPTY_DATA };
}
