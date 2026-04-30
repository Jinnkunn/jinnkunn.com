import { describe, expect, it } from "vitest";

import {
  ALL_WORKSPACE_SURFACES,
  getCommandActions,
  getDashboardActions,
  getDefaultEnabledModuleIds,
  getEnabledModuleSurfaces,
  WORKSPACE_MODULES,
} from "./registry";

describe("workspace module registry", () => {
  it("keeps Workspace as core chrome and exposes first-party modules after it", () => {
    expect(ALL_WORKSPACE_SURFACES.map((surface) => surface.id)).toEqual([
      "workspace",
      "site-admin",
      "calendar",
      "notes",
      "todos",
    ]);
    expect(WORKSPACE_MODULES.map((module) => module.id)).toEqual([
      "site-admin",
      "calendar",
      "notes",
      "todos",
    ]);
  });

  it("collects module-owned dashboard and command contributions", () => {
    expect(getDashboardActions().map((action) => action.id)).toEqual([
      "site-admin:status",
      "site-admin:home",
      "site-admin:components",
      "calendar:open",
      "todos:open",
    ]);
    expect(getCommandActions().map((action) => action.id)).toEqual([
      "quick:site-status",
      "quick:home-editor",
      "quick:shared-content",
      "quick:site-links",
      "quick:todos",
    ]);
  });

  it("filters surfaces and contributions by enabled modules", () => {
    expect(getDefaultEnabledModuleIds()).toEqual([
      "site-admin",
      "calendar",
      "notes",
      "todos",
    ]);
    expect(getEnabledModuleSurfaces(["notes", "todos"]).map((surface) => surface.id)).toEqual([
      "workspace",
      "notes",
      "todos",
    ]);
    expect(getDashboardActions(["todos"]).map((action) => action.id)).toEqual([
      "todos:open",
    ]);
    expect(getCommandActions(["todos"]).map((action) => action.id)).toEqual([
      "quick:todos",
    ]);
  });
});
