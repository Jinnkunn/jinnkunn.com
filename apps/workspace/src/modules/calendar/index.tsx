import { CalendarIcon } from "../../surfaces/icons";
import { CalendarSurface } from "../../surfaces/calendar/CalendarSurface";
import type { WorkspaceModuleDefinition } from "../types";

export const CALENDAR_MODULE: WorkspaceModuleDefinition = {
  id: "calendar",
  enabledByDefault: true,
  surface: {
    id: "calendar",
    title: "Calendar",
    description: "Aggregated from macOS Calendar",
    icon: <CalendarIcon />,
    Component: CalendarSurface,
  },
  dashboardActions: [
    {
      id: "calendar:open",
      description: "Daily schedule",
      label: "Calendar",
      surfaceId: "calendar",
    },
  ],
};
