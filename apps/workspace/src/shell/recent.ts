// Locally persisted navigation history for the workspace shell. This is
// intentionally generic: surfaces own their data, the shell only remembers
// which surface/nav id the user opened recently.

const STORAGE_KEY = "workspace.sidebar.recent.v1";
const MAX_RECENT_ITEMS = 8;

export interface SidebarRecentItem {
  itemId: string;
  label: string;
  surfaceId: string;
  surfaceTitle: string;
  visitedAt: number;
}

export function loadRecentItems(): SidebarRecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SidebarRecentItem[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const surfaceId = typeof entry.surfaceId === "string" ? entry.surfaceId : "";
      const itemId = typeof entry.itemId === "string" ? entry.itemId : "";
      const label =
        typeof entry.label === "string" && entry.label ? entry.label : itemId;
      const surfaceTitle =
        typeof entry.surfaceTitle === "string" && entry.surfaceTitle
          ? entry.surfaceTitle
          : surfaceId;
      const visitedAt =
        typeof entry.visitedAt === "number" && Number.isFinite(entry.visitedAt)
          ? entry.visitedAt
          : 0;
      if (!surfaceId || !itemId) continue;
      out.push({ itemId, label, surfaceId, surfaceTitle, visitedAt });
    }
    return out
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, MAX_RECENT_ITEMS);
  } catch {
    return [];
  }
}

export function persistRecentItems(items: SidebarRecentItem[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items.slice(0, MAX_RECENT_ITEMS)),
    );
  } catch {
    // ignore quota / private-mode errors
  }
}

export function touchRecentItem(
  items: SidebarRecentItem[],
  entry: Omit<SidebarRecentItem, "visitedAt">,
): SidebarRecentItem[] {
  const next = [
    { ...entry, visitedAt: Date.now() },
    ...items.filter(
      (item) =>
        item.surfaceId !== entry.surfaceId || item.itemId !== entry.itemId,
    ),
  ];
  return next.slice(0, MAX_RECENT_ITEMS);
}
