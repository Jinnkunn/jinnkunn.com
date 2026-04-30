import { NotesIcon } from "../../surfaces/icons";
import {
  NOTES_DEFAULT_NAV_ITEM_ID,
  NOTES_NAV_GROUPS,
} from "../../surfaces/notes/nav";
import { NotesSurface } from "../../surfaces/notes/NotesSurface";
import type { WorkspaceModuleDefinition } from "../types";

export const NOTES_MODULE: WorkspaceModuleDefinition = {
  id: "notes",
  enabledByDefault: true,
  surface: {
    id: "notes",
    title: "Notes",
    description: "Local Notion-like notes",
    icon: <NotesIcon />,
    Component: NotesSurface,
    navGroups: NOTES_NAV_GROUPS,
    defaultNavItemId: NOTES_DEFAULT_NAV_ITEM_ID,
  },
};
