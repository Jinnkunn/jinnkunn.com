import { lazy } from "react";

import { TodosIcon } from "../../surfaces/icons";
import {
  TODOS_DEFAULT_NAV_ITEM_ID,
  TODOS_NAV_GROUPS,
} from "../../surfaces/todos/nav";
import type { WorkspaceModuleDefinition } from "../types";

const TodosSurface = lazy(() =>
  import("../../surfaces/todos/TodosSurface").then((module) => ({
    default: module.TodosSurface,
  })),
);

export const TODOS_MODULE: WorkspaceModuleDefinition = {
  id: "todos",
  enabledByDefault: true,
  surface: {
    id: "todos",
    title: "Todos",
    description: "Tasks",
    icon: <TodosIcon />,
    Component: TodosSurface,
    navGroups: TODOS_NAV_GROUPS,
    defaultNavItemId: TODOS_DEFAULT_NAV_ITEM_ID,
  },
  dashboardActions: [
    {
      id: "todos:open",
      description: "Today",
      label: "Todos",
      navItemId: TODOS_DEFAULT_NAV_ITEM_ID,
      surfaceId: "todos",
    },
  ],
  commandActions: [
    {
      id: "quick:todos",
      hint: "Today",
      keywords: "todos tasks checklist today upcoming scheduled inbox due",
      label: "Open Today",
      navItemId: TODOS_DEFAULT_NAV_ITEM_ID,
      surfaceId: "todos",
    },
  ],
};
