import type {
  SiteAdminNowData,
  SiteAdminNowLink,
  SiteAdminNowUpdate,
} from "./api-types";

export const NOW_STATUS_MAX_LENGTH = 180;
export const NOW_CONTEXT_MAX_LENGTH = 180;
export const NOW_LOCATION_MAX_LENGTH = 80;
export const NOW_UPDATES_MAX_COUNT = 20;

const EMPTY_DATA: SiteAdminNowData = {
  current: {
    text: "Working quietly.",
  },
  updates: [],
  links: [],
};

function readRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function readString(raw: unknown, maxLength = 500): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length > maxLength ? value.slice(0, maxLength).trim() : value;
}

function optionalString(raw: unknown, maxLength: number): string | undefined {
  return readString(raw, maxLength) || undefined;
}

function normalizeNowUpdate(raw: unknown): SiteAdminNowUpdate | null {
  const record = readRecord(raw);
  if (!record) return null;
  const id = readString(record.id, 120);
  const text = readString(record.text, NOW_STATUS_MAX_LENGTH);
  const at = readString(record.at, 80);
  if (!id || !text || !at) return null;
  return { id, text, at };
}

function normalizeNowLink(raw: unknown): SiteAdminNowLink | null {
  const record = readRecord(raw);
  if (!record) return null;
  const label = readString(record.label, 80);
  const href = readString(record.href, 300);
  if (!label || !href) return null;
  return { label, href };
}

export function normalizeNowData(raw: unknown): SiteAdminNowData {
  const record = readRecord(raw);
  if (!record) return emptyNowData();
  const currentRaw = readRecord(record.current) ?? {};
  const current: SiteAdminNowData["current"] = {
    text: readString(currentRaw.text, NOW_STATUS_MAX_LENGTH) || EMPTY_DATA.current.text,
  };
  const context = optionalString(currentRaw.context, NOW_CONTEXT_MAX_LENGTH);
  const location = optionalString(currentRaw.location, NOW_LOCATION_MAX_LENGTH);
  const updatedAt = optionalString(currentRaw.updatedAt, 80);
  if (context) current.context = context;
  if (location) current.location = location;
  if (updatedAt) current.updatedAt = updatedAt;

  return {
    current,
    updates: Array.isArray(record.updates)
      ? record.updates
          .map(normalizeNowUpdate)
          .filter((item): item is SiteAdminNowUpdate => Boolean(item))
          .slice(0, NOW_UPDATES_MAX_COUNT)
      : [],
    links: Array.isArray(record.links)
      ? record.links
          .map(normalizeNowLink)
          .filter((item): item is SiteAdminNowLink => Boolean(item))
      : [],
  };
}

export function emptyNowData(): SiteAdminNowData {
  return {
    current: { ...EMPTY_DATA.current },
    updates: [],
    links: [],
  };
}
