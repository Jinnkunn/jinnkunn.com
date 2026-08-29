import "server-only";

import { readContentJson } from "@/lib/server/content-json";
import {
  DEFAULT_ANNOUNCEMENTS_DOCUMENT,
  normalizeAnnouncementsDocument,
  type AnnouncementsDocument,
} from "@/lib/shared/announcements";

export function getAnnouncementsDocument(): AnnouncementsDocument {
  const parsed = readContentJson("announcements.json");
  return parsed
    ? normalizeAnnouncementsDocument(parsed)
    : structuredClone(DEFAULT_ANNOUNCEMENTS_DOCUMENT);
}
