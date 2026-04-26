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
