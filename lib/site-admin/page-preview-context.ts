import matter from "gray-matter";
import { getActiveMonochromeAppearance, type MonochromeAppearance } from "../appearance.ts";
import { announcementVisibleOnRoute, getActiveAnnouncement, normalizeAnnouncementsDocument, type SiteAnnouncement } from "../shared/announcements.ts";
import { SITE_COMPONENT_DEFINITIONS } from "./component-registry.ts";

export type PagePreviewOptions = { title: string; home?: boolean; routePath?: string; announcement?: SiteAnnouncement };

export function pagePreviewContext(sources: Record<string, string>, pathname: string, candidate?: SiteAnnouncement, now = new Date()) {
  const announcements = normalizeAnnouncementsDocument(sources["filesystem/announcements.json"] ? JSON.parse(sources["filesystem/announcements.json"]) : undefined);
  const active = candidate || getActiveAnnouncement(announcements, now);
  const config = sources["filesystem/site-config.json"] ? JSON.parse(sources["filesystem/site-config.json"]) : {};
  const appearance = config.appearance?.monochrome || config.memorial || {};
  const monochrome = getActiveMonochromeAppearance({
    enabled: appearance.enabled === true, scope: appearance.scope === "home" ? "home" : "all-public",
    desaturateMedia: appearance.desaturateMedia !== false, startsAt: String(appearance.startsAt || ""), endsAt: String(appearance.endsAt || ""),
  } satisfies MonochromeAppearance, now);
  return { announcement: active && announcementVisibleOnRoute(active, pathname) ? active : null, monochrome: monochrome && (monochrome.scope === "all-public" || pathname === "/") ? monochrome : null };
}

// Only standalone embed blocks are expanded. Fenced code remains literal.
export function resolvePreviewEmbeds(source: string, sources: Record<string, string>): string {
  let fence = "";
  return source.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ""; return line; }
    if (fence) return line;
    for (const definition of SITE_COMPONENT_DEFINITIONS) {
      if (new RegExp(`^\\s*<${definition.embedTag}\\s*/>\\s*$`).test(line)) {
        const body = sources[`components/${definition.name}.mdx`];
        if (body) return matter(body).content;
      }
    }
    return line;
  }).join("\n");
}
