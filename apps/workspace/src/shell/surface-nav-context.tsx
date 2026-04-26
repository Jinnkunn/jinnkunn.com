import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { SurfaceNavItem } from "../surfaces/types";

interface SurfaceNavContextValue {
  /** Active nav item id within the current surface, or null when the
   * surface has no nav groups (flat surface). */
  activeNavItemId: string | null;
  /** Switches the nav item. The shell persists the value per-surface so
   * reopening a surface lands on the last-viewed leaf. */
  setActiveNavItemId: (id: string) => void;
  /** Lets the active surface publish a dynamic child tree under one of
   * its static nav items. Pass `null` (or empty) to remove. App.tsx
   * walks each item in the surface's static `navGroups` and replaces
   * `item.children` with the dynamic tree before passing the surface
   * to the Sidebar. */
  setNavItemChildren: (
    itemId: string,
    children: readonly SurfaceNavItem[] | null,
  ) => void;
  /** Surfaces register a callback here to handle drag-reparent. Sidebar
   * fires onMoveNavItem → App routes it to the active surface's
   * registered handler. Pass `null` to clear. */
  setMoveNavItemHandler: (
    handler: ((fromId: string, toId: string) => void) | null,
  ) => void;
  /** Surfaces register a callback here to handle inline rename. Sidebar
   * fires onRenameNavItem with the row id and the new slug; the surface
   * decides what API call to make. Pass `null` to clear. */
  setRenameNavItemHandler: (
    handler: ((itemId: string, newSlug: string) => void) | null,
  ) => void;
  /** Optional live-validation hook for the rename input. Sidebar calls
   * this on every keystroke; returning a non-empty string surfaces it
   * as inline error text and disables Enter submit. Pass `null` to
   * clear (input falls back to "any non-empty value" client-side). */
  setRenameValidator: (
    validator: ((itemId: string, newSlug: string) => string | null) | null,
  ) => void;
}

const SurfaceNavContext = createContext<SurfaceNavContextValue | null>(null);

export function SurfaceNavProvider({
  value,
  children,
}: {
  value: SurfaceNavContextValue;
  children: ReactNode;
}) {
  return (
    <SurfaceNavContext.Provider value={value}>
      {children}
    </SurfaceNavContext.Provider>
  );
}

export function useSurfaceNav(): SurfaceNavContextValue {
  const ctx = useContext(SurfaceNavContext);
  if (!ctx) {
    throw new Error(
      "useSurfaceNav must be used inside <SurfaceNavProvider> (check App.tsx)",
    );
  }
  return ctx;
}
