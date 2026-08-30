export type AnnouncementStatus = "draft" | "published" | "archived";
export type AnnouncementScope = "home" | "all-public" | "paths";
export type AnnouncementLayout = "prose" | "columns";
export type AnnouncementInitialState = "route-aware" | "expanded" | "compact";

export type SiteAnnouncement = {
  id: string;
  title: string;
  status: AnnouncementStatus;
  scope: AnnouncementScope;
  routes: string[];
  layout: AnnouncementLayout;
  initialState: AnnouncementInitialState;
  collapsible: boolean;
  compactMdx: string;
  bodyMdx: string;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
};

export type AnnouncementsDocument = {
  version: 1;
  items: SiteAnnouncement[];
};

const CURRENT_ANNOUNCEMENT: SiteAnnouncement = {
  id: "shigatse-gyirong-2026",
  title: "Shigatse · Gyirong remembrance",
  status: "published",
  scope: "all-public",
  routes: [],
  layout: "columns",
  initialState: "route-aware",
  collapsible: true,
  compactMdx:
    "Shigatse · Gyirong / 日喀则 · 吉隆\n\n[Latest Updates](https://so.news.cn/?lang=en#search/0/Gyirong/1/) · [最新消息](https://so.news.cn/#search/0/%E6%97%A5%E5%96%80%E5%88%99/1/0)",
  bodyMdx: `## Shigatse · Gyirong

### In memory of those who lost their lives in the Gyirong mudslide.

On August 26, 2026, a mudslide struck the Gyirong Port area in Gyirong County, Shigatse.

May those who lost their lives rest in peace. May those still missing return safely. May the search and rescue proceed safely, and may everyone taking part return home safe.

Our thoughts are also with those who work and serve at Gyirong Port, and with everyone affected by the disaster and their families.

Rescue efforts are ongoing. Please refer to official updates for the latest information.

[Latest Updates](https://so.news.cn/?lang=en#search/0/Gyirong/1/)

---

## 日喀则 · 吉隆

### 谨悼日喀则吉隆泥石流灾害遇难者。

2026年8月26日，日喀则市吉隆县吉隆口岸区域发生泥石流灾害。

愿逝者安息。愿失联者早日平安归来，也愿搜救顺利，所有参与救援的人平安。

也牵挂那些在吉隆口岸工作和驻守的人们，以及所有受灾群众和他们的家人。愿他们平安。

救援仍在进行，相关信息请以官方通报为准。

[最新消息](https://so.news.cn/#search/0/%E6%97%A5%E5%96%80%E5%88%99/1/0)`,
  startsAt: "2026-08-29",
  endsAt: "",
  updatedAt: "2026-08-29T12:00:00-03:00",
};

export const DEFAULT_ANNOUNCEMENTS_DOCUMENT: AnnouncementsDocument = {
  version: 1,
  items: [CURRENT_ANNOUNCEMENT],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, maxLength = 100_000): string {
  return typeof value === "string" ? value.slice(0, maxLength).trim() : "";
}

function normalizeRoutes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => text(item, 300))
        .filter(Boolean)
        .map((item) => (item.startsWith("/") ? item : `/${item}`)),
    ),
  ).slice(0, 30);
}

export function normalizeAnnouncement(
  value: unknown,
  fallbackId = "announcement",
): SiteAnnouncement | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 120) || fallbackId;
  const title = text(value.title, 240) || "Untitled announcement";
  const status: AnnouncementStatus =
    value.status === "published" || value.status === "archived"
      ? value.status
      : "draft";
  const scope: AnnouncementScope =
    value.scope === "home" || value.scope === "paths" ? value.scope : "all-public";
  const layout: AnnouncementLayout = value.layout === "columns" ? "columns" : "prose";
  const initialState: AnnouncementInitialState =
    value.initialState === "expanded" || value.initialState === "compact"
      ? value.initialState
      : "route-aware";
  return {
    id,
    title,
    status,
    scope,
    routes: normalizeRoutes(value.routes),
    layout,
    initialState,
    collapsible: value.collapsible !== false,
    compactMdx: text(value.compactMdx, 4_000),
    bodyMdx: text(value.bodyMdx),
    startsAt: text(value.startsAt, 40),
    endsAt: text(value.endsAt, 40),
    updatedAt: text(value.updatedAt, 80),
  };
}

export function normalizeAnnouncementsDocument(value: unknown): AnnouncementsDocument {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return structuredClone(DEFAULT_ANNOUNCEMENTS_DOCUMENT);
  }
  const seen = new Set<string>();
  const items: SiteAnnouncement[] = [];
  value.items.forEach((item, index) => {
    const normalized = normalizeAnnouncement(item, `announcement-${index + 1}`);
    if (!normalized || seen.has(normalized.id)) return;
    seen.add(normalized.id);
    items.push(normalized);
  });
  return { version: 1, items };
}

function timestamp(raw: string, endOfDay = false): number | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = Date.parse(
    dateOnly
      ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}-03:00`
      : value,
  );
  return Number.isFinite(parsed) ? parsed : null;
}

export function isAnnouncementActive(
  announcement: SiteAnnouncement,
  now: Date = new Date(),
): boolean {
  if (announcement.status !== "published" || !announcement.bodyMdx.trim()) return false;
  const nowMs = now.getTime();
  const startsAt = timestamp(announcement.startsAt);
  const endsAt = timestamp(announcement.endsAt, true);
  if (startsAt !== null && nowMs < startsAt) return false;
  if (endsAt !== null && nowMs > endsAt) return false;
  return true;
}

export function getActiveAnnouncement(
  document: AnnouncementsDocument,
  now: Date = new Date(),
): SiteAnnouncement | null {
  return document.items.find((item) => isAnnouncementActive(item, now)) ?? null;
}

export function splitAnnouncementColumns(source: string): string[] {
  const horizontalRule =
    /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/m;
  const match = horizontalRule.exec(source);
  if (!match || match.index === undefined) {
    const content = source.trim();
    return content ? [content] : [];
  }

  const parts = [
    source.slice(0, match.index).trim(),
    source.slice(match.index + match[0].length).trim(),
  ].filter(Boolean);
  return parts.length > 1 ? parts : source.trim() ? [source.trim()] : [];
}
