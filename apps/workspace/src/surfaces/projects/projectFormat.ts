import type {
  ProjectLinkRow,
  ProjectLinkTargetType,
  ProjectRow,
  ProjectStatus,
} from "../../modules/projects/api";
import type { TodoRow } from "../../modules/todos/api";
import {
  PROJECTS_ACTIVE_NAV_ID,
  PROJECTS_ARCHIVED_NAV_ID,
  PROJECTS_COMPLETED_NAV_ID,
  PROJECTS_PAUSED_NAV_ID,
  projectIdFromNavItem,
} from "./nav";

export const PROJECT_STATUS_OPTIONS: ProjectStatus[] = [
  "active",
  "paused",
  "completed",
];

export const PROJECT_LINK_TYPES: ProjectLinkTargetType[] = ["url", "note"];

export type ProjectView =
  | "active"
  | "archived"
  | "completed"
  | "detail"
  | "home"
  | "paused";

export interface ProjectLinkDraft {
  label: string;
  target: string;
  type: ProjectLinkTargetType;
}

export type ProjectUpdatePatch = Partial<
  Pick<ProjectRow, "description" | "dueAt" | "status" | "title">
> & {
  pinned?: boolean;
};

export function viewFromNavItem(id: string | null): ProjectView {
  if (projectIdFromNavItem(id)) return "detail";
  if (id === PROJECTS_ACTIVE_NAV_ID) return "active";
  if (id === PROJECTS_PAUSED_NAV_ID) return "paused";
  if (id === PROJECTS_COMPLETED_NAV_ID) return "completed";
  if (id === PROJECTS_ARCHIVED_NAV_ID) return "archived";
  return "home";
}

export function viewTitle(view: ProjectView): string {
  if (view === "active") return "Active";
  if (view === "paused") return "Paused";
  if (view === "completed") return "Completed";
  if (view === "archived") return "Archived";
  if (view === "detail") return "Project";
  return "Home";
}

export function statusLabel(status: ProjectStatus): string {
  if (status === "completed") return "Completed";
  if (status === "paused") return "Paused";
  return "Active";
}

export function linkTypeLabel(type: ProjectLinkTargetType): string {
  if (type === "calendarEvent") return "Calendar";
  if (type === "contact") return "Contact";
  if (type === "note") return "Note";
  return "URL";
}

export function formatShortDate(timestamp: number | null): string {
  if (!timestamp) return "No due date";
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function dateInputValue(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function timestampFromDateInput(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 9, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function attentionReasonLabel(
  reason: "dueSoon" | "inactive" | "noNextAction",
): string {
  if (reason === "dueSoon") return "Due soon";
  if (reason === "inactive") return "Quiet";
  return "No next action";
}

export function todoMeta(todo: TodoRow): string {
  const timestamp = todo.scheduledStartAt ?? todo.dueAt;
  if (!timestamp) return "Unscheduled";
  return formatShortDate(timestamp);
}

export function linkUrl(link: ProjectLinkRow): string | null {
  if (link.targetType !== "url") return null;
  return link.url ?? link.targetId;
}

export function linkIsOpenable(link: ProjectLinkRow): boolean {
  return link.targetType === "note" || linkUrl(link) !== null;
}

export function linkMetaLabel(link: ProjectLinkRow): string {
  const label = linkTypeLabel(link.targetType);
  if (linkIsOpenable(link)) return label;
  return `${label} reference`;
}
