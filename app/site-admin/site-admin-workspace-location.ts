export type WorkspaceLocation = { area: string; view: string; kind?: string; id?: string };
const areas = new Set(["content", "home", "now", "announcements", "release", "settings", "media"]);
const kinds = new Set(["posts", "pages", "components"]);
export function parseWorkspaceLocation(url: string): WorkspaceLocation {
  const query = new URL(url, "https://local.invalid").searchParams;
  const area = query.get("area") || "content";
  const view = query.get("view") || "posts";
  const kind = query.get("kind") || "";
  const id = query.get("id") || "";
  return { area: areas.has(area) ? area : "content", view: ["posts", "pages", "collections"].includes(view) ? view : "posts", ...(kinds.has(kind) && id && id.length < 250 ? { kind, id } : {}) };
}
export function workspaceUrl(location: WorkspaceLocation): string {
  const query = new URLSearchParams({ area: location.area, view: location.view });
  if (location.area === "content" && location.kind && location.id) { query.set("kind", location.kind); query.set("id", location.id); }
  return `/site-admin?${query}`;
}
