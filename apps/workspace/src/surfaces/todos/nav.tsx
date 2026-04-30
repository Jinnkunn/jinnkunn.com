import { TodosIcon } from "../icons";
import type { SurfaceNavGroup } from "../types";

export const TODOS_ACTIVE_NAV_ID = "todos:active";
export const TODOS_ALL_NAV_ID = "todos:all";
export const TODOS_COMPLETED_NAV_ID = "todos:completed";
export const TODOS_DEFAULT_NAV_ITEM_ID = TODOS_ACTIVE_NAV_ID;

export const TODOS_NAV_GROUPS: readonly SurfaceNavGroup[] = [
  {
    id: "todos",
    label: "Todos",
    hideHeader: true,
    items: [
      {
        id: TODOS_ACTIVE_NAV_ID,
        label: "Open",
        icon: <TodosIcon />,
      },
      {
        id: TODOS_ALL_NAV_ID,
        label: "All",
      },
      {
        id: TODOS_COMPLETED_NAV_ID,
        label: "Done",
      },
    ],
  },
];
