import type { NextRequest } from "next/server";
import { announcementFrameData, renderAnnouncementPanels } from "@/components/site-announcement";
import { loadPublishedSource } from "@/lib/server/active-publication";
import { getAnnouncementSchedule, normalizeAnnouncementsDocument } from "@/lib/shared/announcements";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest) {
  if (process.env.STAGING_GATE === "1") {
    const { isSiteAdminAuthorized } = await import("@/lib/site-admin-auth");
    if (!await isSiteAdminAuthorized(request)) return new Response(null, { status: 401, headers });
  }
  const { source } = await loadPublishedSource("filesystem/announcements.json");
  if (!source) return Response.json({ announcement: null, refreshAt: null }, { headers });
  const { announcement, refreshAt } = getAnnouncementSchedule(normalizeAnnouncementsDocument(JSON.parse(source)));
  if (!announcement) return Response.json({ announcement: null, refreshAt }, { headers });
  const [{ renderToStaticMarkup }, panels] = await Promise.all([import("react-dom/server"), renderAnnouncementPanels(announcement)]);
  return Response.json({ announcement: announcementFrameData(announcement), refreshAt,
    compact: renderToStaticMarkup(panels.compact), expanded: renderToStaticMarkup(panels.expanded) }, { headers });
}
