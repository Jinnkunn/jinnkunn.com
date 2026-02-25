export type MoreFocusTarget = "first" | "last" | number;

export function getMoreMenuItems(moreMenu: HTMLElement): HTMLElement[] {
  return Array.from(moreMenu.querySelectorAll<HTMLElement>("a.super-navbar__list-item"));
}

export function focusMoreMenuItem(moreMenu: HTMLElement, which: MoreFocusTarget): void {
  const items = getMoreMenuItems(moreMenu);
  if (items.length === 0) return;
  if (which === "first") {
    items[0]?.focus();
    return;
  }
  if (which === "last") {
    items[items.length - 1]?.focus();
    return;
  }
  const idx = ((which % items.length) + items.length) % items.length;
  items[idx]?.focus();
}
