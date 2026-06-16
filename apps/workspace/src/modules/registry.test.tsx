import { describe, expect, it } from "vitest";

import {
  ALL_WORKSPACE_SURFACES,
  getCommandActions,
  getDashboardActions,
  getDefaultEnabledModuleIds,
  getEnabledModuleSurfaces,
  reconcileEnabledModules,
  WORKSPACE_MODULES,
} from "./registry";

describe("workspace module registry", () => {
  it("keeps Workspace as core chrome and exposes first-party modules after it", () => {
    expect(ALL_WORKSPACE_SURFACES.map((surface) => surface.id)).toEqual([
      "workspace",
      "site-admin",
      "calendar",
    ]);
    expect(WORKSPACE_MODULES.map((module) => module.id)).toEqual([
      "site-admin",
      "calendar",
    ]);
  });

  it("collects module-owned dashboard and command contributions", () => {
    expect(getDashboardActions().map((action) => action.id)).toEqual([
      "site-admin:status",
      "site-admin:home",
      "site-admin:components",
      "calendar:open",
    ]);
    expect(getCommandActions().map((action) => action.id)).toEqual([
      "quick:site-status",
      "quick:home-editor",
      "quick:shared-content",
      "quick:site-links",
    ]);
  });

  it("filters surfaces and contributions by enabled modules", () => {
    expect(getDefaultEnabledModuleIds()).toEqual([
      "site-admin",
      "calendar",
    ]);
    expect(getEnabledModuleSurfaces(["calendar", "todos"]).map((surface) => surface.id)).toEqual([
      "workspace",
      "calendar",
    ]);
    expect(getDashboardActions(["calendar"]).map((action) => action.id)).toEqual([
      "calendar:open",
    ]);
    expect(getCommandActions(["calendar"]).map((action) => action.id)).toEqual([]);
  });

  it("reconciles fresh installs by handing out the registry defaults", () => {
    const result = reconcileEnabledModules(null, null);
    expect(result.enabled).toEqual([
      "site-admin",
      "calendar",
    ]);
    expect(result.knownModuleIds).toEqual([
      "site-admin",
      "calendar",
    ]);
  });

  it("reconcile preserves prior opt-outs for modules already known", () => {
    // User had every historical module known. The slim workbench drops
    // non-core ids even if they were previously enabled.
    const result = reconcileEnabledModules(
      ["site-admin", "calendar", "notes", "projects"],
      ["site-admin", "calendar", "notes", "todos", "projects", "contacts"],
    );
    expect(result.enabled).toEqual(["site-admin", "calendar"]);
  });

  it("reconcile does not re-enable retired modules from old installs", () => {
    const result = reconcileEnabledModules(
      ["site-admin", "calendar", "notes", "todos"],
      ["site-admin", "calendar", "notes", "todos"],
    );
    expect(result.enabled).toEqual([
      "site-admin",
      "calendar",
    ]);
    expect(result.knownModuleIds).toEqual(["site-admin", "calendar"]);
  });

  it("reconcile drops persisted ids that no longer match a real module", () => {
    const result = reconcileEnabledModules(
      ["site-admin", "calendar", "long-gone-module"],
      ["site-admin", "calendar", "long-gone-module"],
    );
    expect(result.enabled).not.toContain("long-gone-module");
  });
});
