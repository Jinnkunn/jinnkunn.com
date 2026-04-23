import type { ComponentType, ReactNode } from "react";

/** One feature surface (site-admin, calendar, settings, etc.).
 *
 * Surfaces are the unit of extensibility — adding a new tool means
 * writing a `Component` + dropping a `SurfaceDefinition` into
 * `registry.ts`. The shell stays thin: it doesn't know what the surface
 * does, only how to show it in the sidebar and mount it in the main pane.
 *
 * Each surface owns its own state, its own API layer, and (via
 * `createNamespacedSecureStorage`) its own secure-storage namespace.
 * Nothing site-admin-specific lives at the shell level. */
export interface SurfaceDefinition {
  /** Stable id — used as the URL fragment / localStorage key / secure
   * storage namespace. Keep in kebab-case. */
  id: string;
  /** Human label shown in sidebar + titlebar breadcrumb. */
  title: string;
  /** Short one-liner shown as the sidebar item's title attribute. */
  description?: string;
  /** Sidebar item icon — inline SVG string or React node. */
  icon?: ReactNode;
  /** Component rendered in the main pane when this surface is active. */
  Component: ComponentType;
  /** Disabled surfaces render as greyed-out sidebar items. Use for
   * placeholders (e.g. "Calendar — coming soon"). */
  disabled?: boolean;
}
