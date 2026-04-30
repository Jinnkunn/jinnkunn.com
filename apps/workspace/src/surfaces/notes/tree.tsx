import { PagesIcon } from "../icons";
import type { SurfaceNavItem } from "../types";
import type { NotesMutation } from "../../modules/notes/api";
import type { NoteRow, NoteTreeNode } from "./types";

export const NOTES_ROOT_NAV_ID = "notes:root";
export const NOTES_ARCHIVE_NAV_ID = "notes:archive";
export const NOTE_NAV_PREFIX = "note:";

export function noteNavId(id: string): string {
  return `${NOTE_NAV_PREFIX}${id}`;
}

export function noteIdFromNavItem(navItemId: string | null | undefined): string | null {
  if (!navItemId?.startsWith(NOTE_NAV_PREFIX)) return null;
  return navItemId.slice(NOTE_NAV_PREFIX.length) || null;
}

export function parentIdFromNavItem(navItemId: string | null | undefined): string | null {
  if (!navItemId || navItemId === NOTES_ROOT_NAV_ID) return null;
  return noteIdFromNavItem(navItemId);
}

function compareNotes(a: NoteRow, b: NoteRow): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.title.localeCompare(b.title);
}

function sortTree(nodes: NoteTreeNode[]): NoteTreeNode[] {
  return nodes
    .sort(compareNotes)
    .map((node) => ({ ...node, children: sortTree(node.children) }));
}

export function buildNoteTree(rows: readonly NoteRow[]): NoteTreeNode[] {
  const byId = new Map<string, NoteTreeNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }

  const roots: NoteTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return sortTree(roots);
}

export function flattenNoteTree(nodes: readonly NoteTreeNode[]): NoteTreeNode[] {
  const out: NoteTreeNode[] = [];
  const visit = (node: NoteTreeNode) => {
    out.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

export function noteTreeToNavItems(nodes: readonly NoteTreeNode[]): SurfaceNavItem[] {
  return nodes.map((node) => ({
    id: noteNavId(node.id),
    label: node.title || "Untitled",
    renameValue: node.title || "Untitled",
    icon: node.icon ? <span aria-hidden="true">{node.icon}</span> : <PagesIcon />,
    canAddChild: true,
    children: noteTreeToNavItems(node.children),
    draggable: true,
    droppable: true,
    orderable: true,
  }));
}

export function findNoteNode(
  nodes: readonly NoteTreeNode[],
  id: string,
): NoteTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNoteNode(node.children, id);
    if (child) return child;
  }
  return null;
}

export function getSiblingNotes(
  rows: readonly NoteRow[],
  noteId: string,
): NoteRow[] {
  const current = rows.find((row) => row.id === noteId);
  if (!current) return [];
  return rows
    .filter((row) => (row.parentId ?? null) === (current.parentId ?? null))
    .sort(compareNotes);
}

export function getRecentNotes(rows: readonly NoteRow[], limit = 6): NoteRow[] {
  return [...rows]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

// Walks up parent_id pointers to assemble the note's path (oldest
// ancestor first, target last). Stops cleanly when an ancestor isn't in
// the live row set — that happens when a parent has been archived but
// the child hasn't, so the chain breaks at the boundary.
export function buildNoteBreadcrumb(
  rows: readonly NoteRow[],
  noteId: string,
): NoteRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const path: NoteRow[] = [];
  let current = byId.get(noteId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return path;
}

export function applyNotesMutation(
  rows: readonly NoteRow[],
  mutation: NotesMutation,
): NoteRow[] {
  if (mutation.removed.length === 0 && mutation.updated.length === 0) {
    return rows as NoteRow[];
  }
  const removed = new Set(mutation.removed);
  const updatedById = new Map(mutation.updated.map((row) => [row.id, row]));
  const merged: NoteRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (removed.has(row.id)) continue;
    const replacement = updatedById.get(row.id);
    if (replacement) {
      merged.push(replacement);
      seen.add(row.id);
    } else {
      merged.push(row);
    }
  }
  for (const row of mutation.updated) {
    if (seen.has(row.id) || removed.has(row.id)) continue;
    merged.push(row);
  }
  return merged;
}
