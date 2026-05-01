import { ArchiveIcon, NotesIcon } from "../icons";
import type { SurfaceNavGroup, SurfaceNavItem } from "../types";
import { NOTES_ARCHIVE_NAV_ID, NOTES_ROOT_NAV_ID } from "./tree";

export const NOTES_DEFAULT_NAV_ITEM_ID = NOTES_ROOT_NAV_ID;
export const NOTES_PAGES_NAV_GROUP_ID = "notes:pages";
export const NOTES_SYSTEM_NAV_GROUP_ID = "notes:system";
export const NOTES_NAV_GROUP_ID = NOTES_PAGES_NAV_GROUP_ID;
export const NOTES_ADD_ROOT_NAV_ID = `add:${NOTES_ROOT_NAV_ID}`;

export const NOTES_ARCHIVE_NAV_ITEM: SurfaceNavItem = {
  id: NOTES_ARCHIVE_NAV_ID,
  label: "Archived",
  icon: <ArchiveIcon />,
};

export const NOTES_HOME_NAV_ITEM: SurfaceNavItem = {
  id: NOTES_ROOT_NAV_ID,
  label: "Home",
  icon: <NotesIcon />,
};

export const NOTES_EMPTY_PAGE_NAV_ITEM: SurfaceNavItem = {
  id: NOTES_ADD_ROOT_NAV_ID,
  label: "New page",
  icon: <NotesIcon />,
};

export const NOTES_NAV_GROUPS: readonly SurfaceNavGroup[] = [
  {
    id: NOTES_PAGES_NAV_GROUP_ID,
    label: "Pages",
    addItemId: NOTES_ADD_ROOT_NAV_ID,
    addLabel: "New top-level page",
    items: [
      // Virtual landing row used only before Notes publishes the live
      // page tree. The mounted sidebar replaces this group with real
      // root pages; when there are none, it publishes a "New page" row.
      {
        id: NOTES_ROOT_NAV_ID,
        label: "Notes",
        icon: <NotesIcon />,
        droppable: true,
      },
    ],
  },
  {
    id: NOTES_SYSTEM_NAV_GROUP_ID,
    label: "System",
    items: [
      NOTES_HOME_NAV_ITEM,
      NOTES_ARCHIVE_NAV_ITEM,
    ],
  },
];
