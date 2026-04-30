import { WorkspaceIcon } from "../surfaces/icons";
import type { SurfaceDefinition } from "../surfaces/types";
import { CALENDAR_MODULE } from "./calendar";
import { NOTES_MODULE } from "./notes";
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
  description: "Personal command center",
  icon: <WorkspaceIcon />,
  Component: WorkspaceSurfacePlaceholder,
};

export const WORKSPACE_MODULES: readonly WorkspaceModuleDefinition[] = [
  SITE_ADMIN_MODULE,
  CALENDAR_MODULE,
  NOTES_MODULE,
  TODOS_MODULE,
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
