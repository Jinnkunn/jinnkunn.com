import { TodosIcon } from "../icons";
import type { SurfaceNavGroup } from "../types";

export const TODOS_INBOX_NAV_ID = "todos:inbox";
export const TODOS_TODAY_NAV_ID = "todos:today";
export const TODOS_UPCOMING_NAV_ID = "todos:upcoming";
export const TODOS_SCHEDULED_NAV_ID = "todos:scheduled";
export const TODOS_UNSCHEDULED_NAV_ID = "todos:unscheduled";
export const TODOS_COMPLETED_NAV_ID = "todos:completed";
export const TODOS_DEFAULT_NAV_ITEM_ID = TODOS_TODAY_NAV_ID;

export const TODO_PLANNING_NAV_IDS = new Set<string>([
  TODOS_INBOX_NAV_ID,
  TODOS_TODAY_NAV_ID,
  TODOS_UPCOMING_NAV_ID,
  TODOS_SCHEDULED_NAV_ID,
  TODOS_UNSCHEDULED_NAV_ID,
  TODOS_COMPLETED_NAV_ID,
]);

export const TODOS_NAV_GROUPS: readonly SurfaceNavGroup[] = [
  {
    id: "todos",
    label: "Plan",
    hideHeader: true,
    items: [
      {
        id: TODOS_INBOX_NAV_ID,
        label: "Inbox",
        icon: <TodosIcon />,
      },
      {
        id: TODOS_TODAY_NAV_ID,
        label: "Today",
      },
      {
        id: TODOS_UPCOMING_NAV_ID,
        label: "Upcoming",
      },
      {
        id: TODOS_SCHEDULED_NAV_ID,
        label: "Scheduled",
      },
      {
        id: TODOS_UNSCHEDULED_NAV_ID,
        label: "Unscheduled",
      },
      {
        id: TODOS_COMPLETED_NAV_ID,
        label: "Done",
      },
    ],
  },
];
