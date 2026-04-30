import { ArchiveIcon, NotesIcon } from "../icons";
import type { SurfaceNavGroup, SurfaceNavItem } from "../types";
import { NOTES_ARCHIVE_NAV_ID, NOTES_ROOT_NAV_ID } from "./tree";

export const NOTES_DEFAULT_NAV_ITEM_ID = NOTES_ROOT_NAV_ID;
export const NOTES_NAV_GROUP_ID = "notes";

export const NOTES_ARCHIVE_NAV_ITEM: SurfaceNavItem = {
  id: NOTES_ARCHIVE_NAV_ID,
  label: "Archived",
  icon: <ArchiveIcon />,
};

export const NOTES_NAV_GROUPS: readonly SurfaceNavGroup[] = [
  {
    id: NOTES_NAV_GROUP_ID,
    label: "Notes",
    hideHeader: true,
    items: [
      // Virtual landing row used only before Notes publishes the live
      // group-level tree. The mounted sidebar replaces this group with
      // real notes directly under the NOTES heading, Notion-style.
      {
        id: NOTES_ROOT_NAV_ID,
        label: "Notes",
        icon: <NotesIcon />,
        canAddChild: true,
        droppable: true,
      },
      NOTES_ARCHIVE_NAV_ITEM,
    ],
  },
];
