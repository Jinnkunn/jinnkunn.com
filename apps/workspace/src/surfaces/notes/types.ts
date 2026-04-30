import type { NoteRow } from "../../modules/notes/api";

export type { NoteDetail, NoteRow } from "../../modules/notes/api";

export interface NoteTreeNode extends NoteRow {
  children: NoteTreeNode[];
}

export type NotesSaveState = "idle" | "dirty" | "saving" | "saved" | "error";
