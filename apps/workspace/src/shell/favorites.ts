// Favorites are pinned shortcuts shown at the top of the sidebar.
// Stored locally as an array of {surfaceId, itemId, label} so the
// shell doesn't have to walk every surface's nav tree to render them
// (also keeps a stale label visible when the underlying item is gone,
// rather than dropping silently).

const STORAGE_KEY = "workspace.sidebar.favorites.v1";

export interface SidebarFavorite {
  surfaceId: string;
  itemId: string;
  label: string;
}

export function loadFavorites(): SidebarFavorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SidebarFavorite[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const surfaceId = typeof entry.surfaceId === "string" ? entry.surfaceId : "";
      const itemId = typeof entry.itemId === "string" ? entry.itemId : "";
      if (!surfaceId || !itemId) continue;
      const label = typeof entry.label === "string" && entry.label
        ? entry.label
        : itemId;
      out.push({ surfaceId, itemId, label });
    }
    return out;
  } catch {
    return [];
  }
}

export function persistFavorites(favorites: SidebarFavorite[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // ignore quota / private-mode errors
  }
}

export function favoritesContain(
  favorites: SidebarFavorite[],
  surfaceId: string,
  itemId: string,
): boolean {
  return favorites.some(
    (f) => f.surfaceId === surfaceId && f.itemId === itemId,
  );
}

export function addFavorite(
  favorites: SidebarFavorite[],
  entry: SidebarFavorite,
): SidebarFavorite[] {
  if (favoritesContain(favorites, entry.surfaceId, entry.itemId)) {
    // Refresh the label in case the page was renamed since it was pinned.
    return favorites.map((f) =>
      f.surfaceId === entry.surfaceId && f.itemId === entry.itemId
        ? { ...f, label: entry.label }
        : f,
    );
  }
  return [...favorites, entry];
}

export function removeFavorite(
  favorites: SidebarFavorite[],
  surfaceId: string,
  itemId: string,
): SidebarFavorite[] {
  return favorites.filter(
    (f) => !(f.surfaceId === surfaceId && f.itemId === itemId),
  );
}
