import { lazy } from "react";

import { NotesIcon } from "../../surfaces/icons";
import {
  NOTES_DEFAULT_NAV_ITEM_ID,
  NOTES_NAV_GROUPS,
} from "../../surfaces/notes/nav";
import type { WorkspaceModuleDefinition } from "../types";

const NotesSurface = lazy(() =>
  import("../../surfaces/notes/NotesSurface").then((module) => ({
    default: module.NotesSurface,
  })),
);

export const NOTES_MODULE: WorkspaceModuleDefinition = {
  id: "notes",
  enabledByDefault: true,
  surface: {
    id: "notes",
    title: "Notes",
    description: "Pages",
    icon: <NotesIcon />,
    Component: NotesSurface,
    navGroups: NOTES_NAV_GROUPS,
    defaultNavItemId: NOTES_DEFAULT_NAV_ITEM_ID,
  },
};
