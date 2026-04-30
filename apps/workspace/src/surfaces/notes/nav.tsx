import { ArchiveIcon, NotesIcon } from "../icons";
import type { SurfaceNavGroup } from "../types";
import { NOTES_ARCHIVE_NAV_ID, NOTES_ROOT_NAV_ID } from "./tree";

export const NOTES_DEFAULT_NAV_ITEM_ID = NOTES_ROOT_NAV_ID;

export const NOTES_NAV_GROUPS: readonly SurfaceNavGroup[] = [
  {
    id: "notes",
    label: "Notes",
    items: [
      {
        id: NOTES_ROOT_NAV_ID,
        label: "Notes",
        icon: <NotesIcon />,
        canAddChild: true,
        droppable: true,
      },
      {
        id: NOTES_ARCHIVE_NAV_ID,
        label: "Archived",
        icon: <ArchiveIcon />,
      },
    ],
  },
];
