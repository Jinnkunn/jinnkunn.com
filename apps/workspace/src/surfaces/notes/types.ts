import type { NoteRow } from "../../lib/tauri";

export type { NoteDetail, NoteRow } from "../../lib/tauri";

export interface NoteTreeNode extends NoteRow {
  children: NoteTreeNode[];
}

export type NotesSaveState = "idle" | "dirty" | "saving" | "saved" | "error";
