import { invoke } from "@tauri-apps/api/core";

export interface TodoRow {
  id: string;
  title: string;
  notes: string;
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
  return invoke("todos_list");
}

export interface TodosCreateParams {
  dueAt?: number | null;
  estimatedMinutes?: number | null;
  notes?: string | null;
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
  scheduledEndAt?: number | null;
  scheduledStartAt?: number | null;
  title?: string;
}

export function todosCreate(params: TodosCreateParams): Promise<TodoRow> {
  return invoke("todos_create", { params });
}

export function todosUpdate(params: TodosUpdateParams): Promise<TodoRow> {
  return invoke("todos_update", { params });
}

export function todosArchive(id: string): Promise<void> {
  return invoke("todos_archive", { id });
}

export function todosClearCompleted(): Promise<number> {
  return invoke("todos_clear_completed");
}
