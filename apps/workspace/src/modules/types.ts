import type { SurfaceDefinition } from "../surfaces/types";

/** A launcher row contributed to the Workspace dashboard. Modules own
 * these so the dashboard does not need to know about individual tools. */
export interface DashboardActionContribution {
  id: string;
  label: string;
  description: string;
  surfaceId: string;
  navItemId?: string;
}

/** A command-palette shortcut contributed by a module. Generic surface
 * and nav commands are still derived from the surface tree; this is for
 * opinionated quick actions such as "Open Site Status". */
export interface WorkspaceCommandContribution {
  id: string;
  label: string;
  keywords: string;
  group?: string;
  hint?: string;
  surfaceId: string;
  navItemId?: string;
}

/** First-party feature module. This intentionally models built-in app
 * modules rather than third-party runtime plugins: code is bundled with
 * the app, while shell-level discovery flows through this manifest. */
export interface WorkspaceModuleDefinition {
  id: string;
  surface: SurfaceDefinition;
  enabledByDefault?: boolean;
  dashboardActions?: readonly DashboardActionContribution[];
  commandActions?: readonly WorkspaceCommandContribution[];
}
