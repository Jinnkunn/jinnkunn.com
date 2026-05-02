import { invoke } from "@tauri-apps/api/core";
import {
  cachedResource,
  invalidateCachedResourcePrefix,
} from "../resourceCache";

export type ProjectStatus = "active" | "paused" | "completed";
export type ProjectLinkTargetType = "note" | "contact" | "calendarEvent" | "url";

export interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: ProjectStatus;
  color: string | null;
  icon: string | null;
  dueAt: number | null;
  pinnedAt: number | null;
  sortOrder: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  openTodoCount: number;
  totalTodoCount: number;
}

export interface ProjectLinkRow {
  id: string;
  projectId: string;
  targetType: ProjectLinkTargetType;
  targetId: string;
  label: string;
  url: string | null;
  createdAt: number;
}

export interface ProjectDetail {
  project: ProjectRow;
  links: ProjectLinkRow[];
}

export interface ProjectsCreateParams {
  color?: string | null;
  description?: string | null;
  dueAt?: number | null;
  icon?: string | null;
  status?: ProjectStatus;
  title?: string | null;
}

export interface ProjectsUpdateParams {
  color?: string | null;
  description?: string;
  dueAt?: number | null;
  icon?: string | null;
  id: string;
  pinned?: boolean;
  status?: ProjectStatus;
  title?: string;
}

export interface ProjectsMoveParams {
  edge?: "before" | "after" | null;
  id: string;
  targetId: string;
}

export interface ProjectLinkCreateParams {
  label?: string | null;
  projectId: string;
  targetId?: string | null;
  targetType: ProjectLinkTargetType;
  url?: string | null;
}

export function projectsList(): Promise<ProjectRow[]> {
  return cachedResource("projects:list", () => invoke("projects_list"));
}

export function projectsGet(id: string): Promise<ProjectDetail | null> {
  return cachedResource(`projects:detail:${id}`, () =>
    invoke("projects_get", { id }),
  );
}

export function projectsCreate(
  params: ProjectsCreateParams,
): Promise<ProjectRow> {
  invalidateCachedResourcePrefix("projects:");
  return invoke("projects_create", { params });
}

export function projectsUpdate(
  params: ProjectsUpdateParams,
): Promise<ProjectRow> {
  invalidateCachedResourcePrefix("projects:");
  return invoke("projects_update", { params });
}

export function projectsArchive(id: string): Promise<void> {
  invalidateCachedResourcePrefix("projects:");
  return invoke("projects_archive", { id });
}

export function projectsUnarchive(id: string): Promise<ProjectRow> {
  invalidateCachedResourcePrefix("projects:");
  return invoke("projects_unarchive", { id });
}

export function projectsMove(
  params: ProjectsMoveParams,
): Promise<ProjectRow[]> {
  invalidateCachedResourcePrefix("projects:");
  return invoke("projects_move", { params });
}

export function projectLinksList(
  projectId: string,
): Promise<ProjectLinkRow[]> {
  return cachedResource(`projects:links:${projectId}`, () =>
    invoke("project_links_list", { params: { projectId } }),
  );
}

export function projectLinksCreate(
  params: ProjectLinkCreateParams,
): Promise<ProjectLinkRow> {
  invalidateCachedResourcePrefix(`projects:links:${params.projectId}`);
  invalidateCachedResourcePrefix(`projects:detail:${params.projectId}`);
  return invoke("project_links_create", { params });
}

export function projectLinksDelete(id: string): Promise<void> {
  invalidateCachedResourcePrefix("projects:");
  return invoke("project_links_delete", { id });
}
