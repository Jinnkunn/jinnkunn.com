import type { ComponentType, ReactNode } from "react";

/** One leaf nav item inside a surface's nested tree. Rendered as an
 * indented row under its group in the shell sidebar. May itself host
 * children (Notion-style page tree) — when `children` is non-empty the
 * row gets its own disclosure chevron and the nested items render at
 * one extra level of indent. */
export interface SurfaceNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  children?: readonly SurfaceNavItem[];
  /** When true the row gets a hover-revealed "+" affordance next to its
   * disclosure chevron. Clicking it fires `onSelectNavItem` with the
   * synthetic id `add:<itemId>`, which surfaces decode into a "create
   * new child" action (e.g. site-admin opens a fresh PageEditor with
   * the slug prefilled to the parent path). */
  canAddChild?: boolean;
  /** Defaults to true. Set false for tree-only folder/group rows that
   * should remain visible for hierarchy but do not map to an editable
   * document. Clicking such a row toggles its children instead of
   * changing the active nav item. */
  selectable?: boolean;
  /** Marks the row as a drag source — Sidebar attaches HTML5 DnD
   * handlers and a "grab" cursor. Pair with `droppable` on intended
   * targets. */
  draggable?: boolean;
  /** Marks the row as a valid drop target. Sidebar highlights it
   * during drag-over and fires `onMoveNavItem` when something is
   * dropped on it. */
  droppable?: boolean;
  /** Shows explicit sibling-order controls. Sidebar fires
   * `onReorderNavItem` with up/down; the surface decides how to persist
   * the order. */
  orderable?: boolean;
}

/** A collapsible group of nav items shown under the active surface in
 * the shell sidebar. Modelled after the old inline site-admin sections
 * (Content / Site / Ops). */
export interface SurfaceNavGroup {
  id: string;
  label: string;
  items: readonly SurfaceNavItem[];
}

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
  /** Nested nav tree rendered under this surface in the shell sidebar
   * when the surface is active. The surface reads/writes the active
   * leaf id via `useSurfaceNav()`. Leave unset for a flat surface. */
  navGroups?: readonly SurfaceNavGroup[];
  /** Default nav item id used on first mount / when persisted value is
   * stale. Required when `navGroups` is set. */
  defaultNavItemId?: string;
}
