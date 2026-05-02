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
      "notes",
      "todos",
      "projects",
      "contacts",
    ]);
    expect(WORKSPACE_MODULES.map((module) => module.id)).toEqual([
      "site-admin",
      "calendar",
      "notes",
      "todos",
      "projects",
      "contacts",
    ]);
  });

  it("collects module-owned dashboard and command contributions", () => {
    expect(getDashboardActions().map((action) => action.id)).toEqual([
      "site-admin:status",
      "site-admin:home",
      "site-admin:components",
      "calendar:open",
      "todos:open",
      "projects:open",
      "contacts:open",
    ]);
    expect(getCommandActions().map((action) => action.id)).toEqual([
      "quick:site-status",
      "quick:home-editor",
      "quick:shared-content",
      "quick:site-links",
      "quick:todos",
      "quick:projects",
      "quick:contacts",
    ]);
  });

  it("filters surfaces and contributions by enabled modules", () => {
    expect(getDefaultEnabledModuleIds()).toEqual([
      "site-admin",
      "calendar",
      "notes",
      "todos",
      "projects",
      "contacts",
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

  it("reconciles fresh installs by handing out the registry defaults", () => {
    const result = reconcileEnabledModules(null, null);
    expect(result.enabled).toEqual([
      "site-admin",
      "calendar",
      "notes",
      "todos",
      "projects",
      "contacts",
    ]);
    expect(result.knownModuleIds).toEqual([
      "site-admin",
      "calendar",
      "notes",
      "todos",
      "projects",
      "contacts",
    ]);
  });

  it("reconcile preserves prior opt-outs for modules already known", () => {
    // User had every module known and disabled "todos" + "contacts"
    // explicitly in a previous session.
    const result = reconcileEnabledModules(
      ["site-admin", "calendar", "notes", "projects"],
      ["site-admin", "calendar", "notes", "todos", "projects", "contacts"],
    );
    expect(result.enabled).toEqual(["site-admin", "calendar", "notes", "projects"]);
  });

  it("reconcile auto-enables newly-added enabled-by-default modules", () => {
    // Old install: user had calendar/notes/todos but had never seen
    // projects/contacts (they shipped after their last save). The
    // migration should append them because they are enabled by default.
    const result = reconcileEnabledModules(
      ["site-admin", "calendar", "notes", "todos"],
      ["site-admin", "calendar", "notes", "todos"],
    );
    expect(result.enabled).toEqual([
      "site-admin",
      "calendar",
      "notes",
      "todos",
      "projects",
      "contacts",
    ]);
    expect(result.knownModuleIds).toContain("projects");
    expect(result.knownModuleIds).toContain("contacts");
  });

  it("reconcile drops persisted ids that no longer match a real module", () => {
    const result = reconcileEnabledModules(
      ["site-admin", "calendar", "long-gone-module"],
      ["site-admin", "calendar", "long-gone-module"],
    );
    expect(result.enabled).not.toContain("long-gone-module");
  });
});
