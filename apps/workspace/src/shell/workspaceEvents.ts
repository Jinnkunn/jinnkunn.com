const STORAGE_KEY = "workspace.events.v1";
const MAX_EVENTS = 20;

export const WORKSPACE_EVENT_NAME = "workspace:event";

export type WorkspaceEventTone = "info" | "success" | "warn" | "error";

export interface WorkspaceEventInput {
  detail?: string;
  source?: string;
  title: string;
  tone?: WorkspaceEventTone;
}

export interface WorkspaceEvent extends WorkspaceEventInput {
  createdAt: number;
  id: string;
  source: string;
  tone: WorkspaceEventTone;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTone(value: unknown): WorkspaceEventTone {
  return value === "success" || value === "warn" || value === "error"
    ? value
    : "info";
}

export function createWorkspaceEvent(input: WorkspaceEventInput): WorkspaceEvent {
  const title = normalizeString(input.title) || "Workspace activity";
  const createdAt = Date.now();
  return {
    createdAt,
    detail: normalizeString(input.detail) || undefined,
    id: `${createdAt}-${Math.random().toString(36).slice(2, 9)}`,
    source: normalizeString(input.source) || "Workspace",
    title,
    tone: normalizeTone(input.tone),
  };
}

export function loadWorkspaceEvents(): WorkspaceEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const events: WorkspaceEvent[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const id = normalizeString(record.id);
      const title = normalizeString(record.title);
      const createdAt =
        typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
          ? record.createdAt
          : 0;
      if (!id || !title || !createdAt) continue;
      events.push({
        createdAt,
        detail: normalizeString(record.detail) || undefined,
        id,
        source: normalizeString(record.source) || "Workspace",
        title,
        tone: normalizeTone(record.tone),
      });
    }
    return events
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

export function persistWorkspaceEvents(events: readonly WorkspaceEvent[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(events.slice(0, MAX_EVENTS)),
    );
  } catch {
    // Ignore quota / private-mode failures; activity remains in memory.
  }
}

export function appendWorkspaceEvent(
  events: readonly WorkspaceEvent[],
  input: WorkspaceEventInput,
): WorkspaceEvent[] {
  return [createWorkspaceEvent(input), ...events].slice(0, MAX_EVENTS);
}

export function emitWorkspaceEvent(input: WorkspaceEventInput): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceEventInput>(WORKSPACE_EVENT_NAME, {
      detail: input,
    }),
  );
}
