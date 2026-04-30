import { invoke } from "@tauri-apps/api/core";

export interface NoteRow {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  sortOrder: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NoteDetail extends NoteRow {
  bodyMdx: string;
}

export interface NoteSearchResult {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  excerpt: string;
  updatedAt: number;
}

export interface NotesMutation {
  removed: string[];
  updated: NoteRow[];
}

export interface NoteCreated {
  note: NoteDetail;
  mutation: NotesMutation;
}

export interface NoteAssetResult {
  url: string;
  key: string;
  size: number;
  contentType: string;
}

export function notesList(): Promise<NoteRow[]> {
  return invoke("notes_list");
}

export function notesListArchived(): Promise<NoteRow[]> {
  return invoke("notes_list_archived");
}

export function notesGet(id: string): Promise<NoteDetail | null> {
  return invoke("notes_get", { id });
}

export function notesCreate(params: {
  afterId?: string | null;
  parentId?: string | null;
  title?: string | null;
}): Promise<NoteCreated> {
  const payload: Record<string, string | null> = {};
  if (params.afterId !== undefined) payload.afterId = params.afterId;
  if (params.parentId !== undefined) payload.parentId = params.parentId;
  if (params.title !== undefined) payload.title = params.title;
  return invoke("notes_create", { params: payload });
}

export function notesUpdate(params: {
  bodyMdx?: string;
  icon?: string | null;
  id: string;
  title?: string;
}): Promise<NoteDetail> {
  const payload: {
    bodyMdx?: string;
    icon?: string | null;
    id: string;
    title?: string;
  } = { id: params.id };
  if (params.bodyMdx !== undefined) payload.bodyMdx = params.bodyMdx;
  if (params.icon !== undefined) payload.icon = params.icon;
  if (params.title !== undefined) payload.title = params.title;
  return invoke("notes_update", { params: payload });
}

export function notesMove(params: {
  edge?: "before" | "after" | null;
  id: string;
  parentId?: string | null;
  targetId?: string | null;
}): Promise<NotesMutation> {
  const payload: {
    edge?: "before" | "after" | null;
    id: string;
    parentId?: string | null;
    targetId?: string | null;
  } = { id: params.id };
  if (params.edge !== undefined) payload.edge = params.edge;
  if (params.parentId !== undefined) payload.parentId = params.parentId;
  if (params.targetId !== undefined) payload.targetId = params.targetId;
  return invoke("notes_move", { params: payload });
}

export function notesArchive(id: string): Promise<NotesMutation> {
  return invoke("notes_archive", { id });
}

export function notesUnarchive(id: string): Promise<NotesMutation> {
  return invoke("notes_unarchive", { id });
}

export function notesSearch(query: string): Promise<NoteSearchResult[]> {
  return invoke("notes_search", { params: { query } });
}

export function notesSaveAsset(params: {
  contentType: string;
  base64: string;
}): Promise<NoteAssetResult> {
  return invoke("notes_save_asset", { params });
}
