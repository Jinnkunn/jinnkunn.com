import { WorkspaceIcon } from "../surfaces/icons";
import type { SurfaceDefinition } from "../surfaces/types";
import { CALENDAR_MODULE } from "./calendar";
import { CONTACTS_MODULE } from "./contacts";
import { NOTES_MODULE } from "./notes";
import { PROJECTS_MODULE } from "./projects";
import { SITE_ADMIN_MODULE } from "./site-admin";
import { TODOS_MODULE } from "./todos";
import type {
  DashboardActionContribution,
  WorkspaceCommandContribution,
  WorkspaceModuleDefinition,
} from "./types";

function WorkspaceSurfacePlaceholder() {
  return null;
}

export const WORKSPACE_CORE_SURFACE: SurfaceDefinition = {
  id: "workspace",
  title: "Workspace",
  description: "Home",
  icon: <WorkspaceIcon />,
  Component: WorkspaceSurfacePlaceholder,
};

export const WORKSPACE_MODULES: readonly WorkspaceModuleDefinition[] = [
  SITE_ADMIN_MODULE,
  CALENDAR_MODULE,
  NOTES_MODULE,
  TODOS_MODULE,
  PROJECTS_MODULE,
  CONTACTS_MODULE,
];

export const MODULE_SURFACES: readonly SurfaceDefinition[] = WORKSPACE_MODULES.map(
  (module) => module.surface,
);

export const ALL_WORKSPACE_SURFACES: readonly SurfaceDefinition[] = [
  WORKSPACE_CORE_SURFACE,
  ...MODULE_SURFACES,
];

export function findWorkspaceModule(
  id: string,
): WorkspaceModuleDefinition | undefined {
  return WORKSPACE_MODULES.find((module) => module.id === id);
}

export function normalizeEnabledModuleIds(
  ids: readonly string[],
): readonly string[] {
  const known = new Set(WORKSPACE_MODULES.map((module) => module.id));
  const out: string[] = [];
  for (const id of ids) {
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function getDefaultEnabledModuleIds(): readonly string[] {
  return WORKSPACE_MODULES
    .filter((module) => module.enabledByDefault !== false)
    .map((module) => module.id);
}

/** Resolution of a "module enablement migration" pass. The shell
 * persists `enabled` as the user's active modules list and
 * `knownModuleIds` as the set of module ids the user has ever
 * encountered, so the next launch can distinguish "they disabled it"
 * from "this module didn't exist yet when their list was last saved." */
export interface ModuleEnablementResolution {
  enabled: readonly string[];
  knownModuleIds: readonly string[];
}

/** Reconcile a persisted enabled-modules list against the current
 * module registry. Used at app boot so net-new first-party modules
 * (e.g. Contacts when it first ships) appear without forcing the user
 * into Settings, while still respecting prior "I disabled this" choices
 * for previously-known modules.
 *
 * Inputs:
 *   - `persisted`: the saved `enabled` list, or `null` on first install.
 *   - `knownModuleIds`: the saved "ever seen" id set, or `null` on
 *     first install / when this migration first ships.
 *
 * Logic:
 *   - First install (`persisted === null`) → use the registry defaults
 *     and mark every currently-registered module as known.
 *   - Otherwise: keep persisted entries that still resolve to a real
 *     module, then append any module whose id isn't in `knownModuleIds`
 *     and whose `enabledByDefault !== false`. Modules removed from the
 *     registry silently drop out via the same filter. */
export function reconcileEnabledModules(
  persisted: readonly string[] | null,
  knownModuleIds: readonly string[] | null,
): ModuleEnablementResolution {
  const allCurrentIds = WORKSPACE_MODULES.map((workspaceModule) => workspaceModule.id);
  if (persisted === null) {
    return {
      enabled: [...getDefaultEnabledModuleIds()],
      knownModuleIds: allCurrentIds,
    };
  }
  const knownSet = new Set(knownModuleIds ?? []);
  const known = new Set(allCurrentIds);
  const result: string[] = [];
  for (const id of persisted) {
    if (known.has(id) && !result.includes(id)) result.push(id);
  }
  for (const workspaceModule of WORKSPACE_MODULES) {
    if (knownSet.has(workspaceModule.id)) continue;
    if (workspaceModule.enabledByDefault === false) continue;
    if (!result.includes(workspaceModule.id)) result.push(workspaceModule.id);
  }
  return {
    enabled: result,
    knownModuleIds: allCurrentIds,
  };
}

export function getEnabledModuleSurfaces(
  enabledModuleIds: readonly string[],
): readonly SurfaceDefinition[] {
  const enabled = new Set(normalizeEnabledModuleIds(enabledModuleIds));
  return [
    WORKSPACE_CORE_SURFACE,
    ...WORKSPACE_MODULES
      .filter((module) => enabled.has(module.id))
      .map((module) => module.surface),
  ];
}

function enabledModules(
  enabledModuleIds?: readonly string[],
): readonly WorkspaceModuleDefinition[] {
  if (!enabledModuleIds) return WORKSPACE_MODULES;
  const enabled = new Set(normalizeEnabledModuleIds(enabledModuleIds));
  return WORKSPACE_MODULES.filter((module) => enabled.has(module.id));
}

export function getDashboardActions(
  enabledModuleIds?: readonly string[],
): readonly DashboardActionContribution[] {
  return enabledModules(enabledModuleIds).flatMap(
    (module) => module.dashboardActions ?? [],
  );
}

export function getCommandActions(
  enabledModuleIds?: readonly string[],
): readonly WorkspaceCommandContribution[] {
  return enabledModules(enabledModuleIds).flatMap(
    (module) => module.commandActions ?? [],
  );
}
