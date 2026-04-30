import { invoke } from "@tauri-apps/api/core";

export interface TodoRow {
  id: string;
  title: string;
  notes: string;
  dueAt: number | null;
  sortOrder: number;
  completedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function todosList(): Promise<TodoRow[]> {
  return invoke("todos_list");
}

export function todosCreate(params: {
  dueAt?: number | null;
  notes?: string | null;
  title?: string | null;
}): Promise<TodoRow> {
  return invoke("todos_create", { params });
}

export function todosUpdate(params: {
  completed?: boolean;
  dueAt?: number | null;
  id: string;
  notes?: string;
  title?: string;
}): Promise<TodoRow> {
  return invoke("todos_update", { params });
}

export function todosArchive(id: string): Promise<void> {
  return invoke("todos_archive", { id });
}

export function todosClearCompleted(): Promise<number> {
  return invoke("todos_clear_completed");
}
