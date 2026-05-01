import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  CalendarRange,
  CircleCheckBig,
  Inbox,
  ListTodo,
  Sun,
} from "lucide-react";

import type { SurfaceNavGroup, SurfaceNavItem } from "../types";

export const TODOS_INBOX_NAV_ID = "todos:inbox";
export const TODOS_TODAY_NAV_ID = "todos:today";
export const TODOS_UPCOMING_NAV_ID = "todos:upcoming";
export const TODOS_SCHEDULED_NAV_ID = "todos:scheduled";
export const TODOS_UNSCHEDULED_NAV_ID = "todos:unscheduled";
export const TODOS_COMPLETED_NAV_ID = "todos:completed";
export const TODOS_DEFAULT_NAV_ITEM_ID = TODOS_TODAY_NAV_ID;
export const TODOS_FOCUS_NAV_GROUP_ID = "todos:focus";
export const TODOS_SCHEDULE_NAV_GROUP_ID = "todos:schedule";
export const TODOS_REVIEW_NAV_GROUP_ID = "todos:review";

export type TodoNavItemId =
  | typeof TODOS_COMPLETED_NAV_ID
  | typeof TODOS_INBOX_NAV_ID
  | typeof TODOS_SCHEDULED_NAV_ID
  | typeof TODOS_TODAY_NAV_ID
  | typeof TODOS_UNSCHEDULED_NAV_ID
  | typeof TODOS_UPCOMING_NAV_ID;

export type TodoNavCounts = Partial<Record<TodoNavItemId, number>>;

export const TODO_PLANNING_NAV_IDS = new Set<string>([
  TODOS_INBOX_NAV_ID,
  TODOS_TODAY_NAV_ID,
  TODOS_UPCOMING_NAV_ID,
  TODOS_SCHEDULED_NAV_ID,
  TODOS_UNSCHEDULED_NAV_ID,
  TODOS_COMPLETED_NAV_ID,
]);

function todoNavIcon(Icon: LucideIcon) {
  return (
    <Icon
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
      size={14}
      strokeWidth={1.6}
    />
  );
}

function todoBadge(
  counts: TodoNavCounts,
  id: TodoNavItemId,
): SurfaceNavItem["badge"] {
  const count = counts[id];
  return count ? String(count) : undefined;
}

function todoItem(
  counts: TodoNavCounts,
  id: TodoNavItemId,
  label: string,
  Icon: LucideIcon,
): SurfaceNavItem {
  return {
    id,
    label,
    badge: todoBadge(counts, id),
    icon: todoNavIcon(Icon),
  };
}

export function createTodosNavGroups(
  counts: TodoNavCounts = {},
): readonly SurfaceNavGroup[] {
  return [
    {
      id: TODOS_FOCUS_NAV_GROUP_ID,
      label: "Focus",
      items: [
        todoItem(counts, TODOS_TODAY_NAV_ID, "Today", Sun),
        todoItem(counts, TODOS_INBOX_NAV_ID, "Inbox", Inbox),
        todoItem(counts, TODOS_UPCOMING_NAV_ID, "Upcoming", CalendarRange),
      ],
    },
    {
      id: TODOS_SCHEDULE_NAV_GROUP_ID,
      label: "Schedule",
      items: [
        todoItem(counts, TODOS_SCHEDULED_NAV_ID, "Scheduled", CalendarClock),
        todoItem(counts, TODOS_UNSCHEDULED_NAV_ID, "Unscheduled", ListTodo),
      ],
    },
    {
      id: TODOS_REVIEW_NAV_GROUP_ID,
      label: "Review",
      items: [
        todoItem(counts, TODOS_COMPLETED_NAV_ID, "Done", CircleCheckBig),
      ],
    },
  ];
}

export const TODOS_NAV_GROUPS: readonly SurfaceNavGroup[] =
  createTodosNavGroups();
