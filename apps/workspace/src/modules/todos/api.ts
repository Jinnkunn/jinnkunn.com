import { invoke } from "@tauri-apps/api/core";
import {
  cachedResource,
  invalidateCachedResourcePrefix,
} from "../resourceCache";

export interface TodoRow {
  id: string;
  title: string;
  notes: string;
  projectId: string | null;
  dueAt: number | null;
  scheduledStartAt: number | null;
  scheduledEndAt: number | null;
  estimatedMinutes: number | null;
  sortOrder: number;
  completedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function todosList(): Promise<TodoRow[]> {
  return cachedResource("todos:list", () => invoke("todos_list"));
}

export function todosListByProject(projectId: string): Promise<TodoRow[]> {
  return cachedResource(`todos:project:${projectId}`, () =>
    invoke("todos_list_by_project", { projectId }),
  );
}

export function todosListByNoteSource(noteId: string): Promise<TodoRow[]> {
  return cachedResource(`todos:note:${noteId}`, () =>
    invoke("todos_list_by_note_source", { noteId }),
  );
}

export function todosListWindow(params: {
  endsAt: number;
  startsAt: number;
}): Promise<TodoRow[]> {
  const key = `todos:window:${params.startsAt}:${params.endsAt}`;
  return cachedResource(key, () => invoke("todos_list_window", { params }));
}

export interface TodosCreateParams {
  dueAt?: number | null;
  estimatedMinutes?: number | null;
  notes?: string | null;
  projectId?: string | null;
  scheduledEndAt?: number | null;
  scheduledStartAt?: number | null;
  title?: string | null;
}

export interface TodosUpdateParams {
  completed?: boolean;
  dueAt?: number | null;
  estimatedMinutes?: number | null;
  id: string;
  notes?: string;
  projectId?: string | null;
  scheduledEndAt?: number | null;
  scheduledStartAt?: number | null;
  title?: string;
}

export function todosCreate(params: TodosCreateParams): Promise<TodoRow> {
  invalidateCachedResourcePrefix("todos:");
  invalidateCachedResourcePrefix("projects:");
  return invoke("todos_create", { params });
}

export function todosUpdate(params: TodosUpdateParams): Promise<TodoRow> {
  invalidateCachedResourcePrefix("todos:");
  invalidateCachedResourcePrefix("projects:");
  return invoke("todos_update", { params });
}

export function todosArchive(id: string): Promise<void> {
  invalidateCachedResourcePrefix("todos:");
  invalidateCachedResourcePrefix("projects:");
  return invoke("todos_archive", { id });
}

export function todosClearCompleted(): Promise<number> {
  invalidateCachedResourcePrefix("todos:");
  invalidateCachedResourcePrefix("projects:");
  return invoke("todos_clear_completed");
}
