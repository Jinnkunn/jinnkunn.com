import { describe, expect, it } from "vitest";

import {
  calendarCapability,
  sourceCanOpenSystemSettings,
  summarizeSourceVisibility,
} from "./calendarManagement";
import type { Calendar, CalendarSource } from "./types";

const localCalendar: Calendar = {
  id: "lcal_personal",
  sourceId: "workspace-local",
  title: "Personal",
  colorHex: "#0a84ff",
  allowsModifications: true,
};

const externalCalendar: Calendar = {
  id: "ek_work",
  sourceId: "icloud",
  title: "Work",
  colorHex: "#ff9500",
  allowsModifications: true,
};

const externalReadOnlyCalendar: Calendar = {
  id: "ek_holidays",
  sourceId: "subscribed",
  title: "Holidays",
  colorHex: "#34c759",
  allowsModifications: false,
};

describe("calendar management model", () => {
  it("summarizes account visibility as empty, hidden, mixed, or visible", () => {
    expect(summarizeSourceVisibility([], new Set()).state).toBe("empty");

    expect(
      summarizeSourceVisibility([localCalendar, externalCalendar], new Set()).state,
    ).toBe("hidden");

    expect(
      summarizeSourceVisibility(
        [localCalendar, externalCalendar],
        new Set([localCalendar.id]),
      ).state,
    ).toBe("mixed");

    expect(
      summarizeSourceVisibility(
        [localCalendar, externalCalendar],
        new Set([localCalendar.id, externalCalendar.id]),
      ).state,
    ).toBe("visible");
  });

  it("only exposes destructive local calendar actions for workspace calendars", () => {
    expect(calendarCapability(localCalendar)).toMatchObject({
      canArchive: true,
      canEditAppearance: true,
      canManageInSystemSettings: false,
      label: "Workspace",
    });
    expect(calendarCapability(externalCalendar)).toMatchObject({
      canArchive: false,
      canEditAppearance: false,
      canManageInSystemSettings: true,
      label: "Writable",
    });
    expect(calendarCapability(externalReadOnlyCalendar)).toMatchObject({
      canArchive: false,
      canEditAppearance: false,
      canManageInSystemSettings: true,
      label: "Read only",
    });
  });

  it("routes external accounts to system settings instead of in-app deletion", () => {
    const workspaceSource: CalendarSource = {
      id: "workspace-local",
      title: "Workspace",
      sourceType: "local",
    };
    const iCloudSource: CalendarSource = {
      id: "icloud",
      title: "iCloud",
      sourceType: "mobileMe",
    };

    expect(sourceCanOpenSystemSettings(workspaceSource)).toBe(false);
    expect(sourceCanOpenSystemSettings(iCloudSource)).toBe(true);
  });
});
