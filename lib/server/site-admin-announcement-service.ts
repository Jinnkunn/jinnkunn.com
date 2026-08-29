import "server-only";

import {
  DEFAULT_ANNOUNCEMENTS_DOCUMENT,
  normalizeAnnouncement,
  normalizeAnnouncementsDocument,
  type AnnouncementsDocument,
  type SiteAnnouncement,
} from "@/lib/shared/announcements";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";

export const ANNOUNCEMENTS_REL_PATH = "content/filesystem/announcements.json";

export async function loadSiteAdminAnnouncements(): Promise<{
  data: AnnouncementsDocument;
  sourceVersion: { fileSha: string };
}> {
  const file = await getSiteAdminSourceStore().readTextFile(ANNOUNCEMENTS_REL_PATH);
  if (!file) {
    return {
      data: structuredClone(DEFAULT_ANNOUNCEMENTS_DOCUMENT),
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
    data: normalizeAnnouncementsDocument(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

async function writeAnnouncements(input: {
  data: AnnouncementsDocument;
  expectedFileSha?: string;
}): Promise<{ data: AnnouncementsDocument; sourceVersion: { fileSha: string } }> {
  const data = normalizeAnnouncementsDocument(input.data);
  const result = await getSiteAdminSourceStore().writeTextFile({
    relPath: ANNOUNCEMENTS_REL_PATH,
    content: `${JSON.stringify(data, null, 2)}\n`,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update announcements",
  });
  return { data, sourceVersion: { fileSha: result.fileSha } };
}

export async function upsertSiteAdminAnnouncement(input: {
  announcement: SiteAnnouncement;
  expectedFileSha?: string;
}) {
  const loaded = await loadSiteAdminAnnouncements();
  const announcement = normalizeAnnouncement(input.announcement, input.announcement.id);
  if (!announcement) throw new Error("Invalid announcement");
  announcement.updatedAt = new Date().toISOString();

  const index = loaded.data.items.findIndex((item) => item.id === announcement.id);
  const items = loaded.data.items.map((item) =>
    announcement.status === "published" && item.id !== announcement.id && item.status === "published"
      ? { ...item, status: "archived" as const }
      : item,
  );
  if (index >= 0) items[index] = announcement;
  else items.unshift(announcement);

  return writeAnnouncements({
    data: { version: 1, items },
    expectedFileSha: input.expectedFileSha,
  });
}

export async function deleteSiteAdminAnnouncement(input: {
  id: string;
  expectedFileSha?: string;
}) {
  const loaded = await loadSiteAdminAnnouncements();
  const items = loaded.data.items.filter((item) => item.id !== input.id);
  if (items.length === loaded.data.items.length) {
    throw new SiteAdminAnnouncementNotFoundError(input.id);
  }
  return writeAnnouncements({
    data: { version: 1, items },
    expectedFileSha: input.expectedFileSha,
  });
}

export class SiteAdminAnnouncementNotFoundError extends Error {
  readonly code = "ANNOUNCEMENT_NOT_FOUND";
  readonly status = 404;

  constructor(id: string) {
    super(`Announcement not found: ${id}`);
    this.name = "SiteAdminAnnouncementNotFoundError";
  }
}
