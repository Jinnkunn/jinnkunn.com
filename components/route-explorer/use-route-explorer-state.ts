"use client";

import type { Dispatch, SetStateAction } from "react";

import type { AdminConfig } from "@/lib/site-admin/route-explorer-model";
import type { AccessMode } from "@/lib/shared/access";

const INITIAL_RENDER_LIMIT = 180;

type AccessKind = AccessMode;
type FilterKind = "all" | "nav" | "overrides";

export type RouteExplorerState = {
  q: string;
  filter: FilterKind;
  cfg: AdminConfig;
  busyId: string;
  err: string;
  collapsed: Record<string, boolean>;
  openAdmin: Record<string, boolean>;
  accessChoice: Record<string, AccessKind>;
  batchAccess: AccessKind;
  batchPassword: string;
  batchBusy: boolean;
  collapsedReady: boolean;
  renderLimit: number;
};

type Action =
  | { type: "set-q"; value: string }
  | { type: "set-filter"; value: FilterKind }
  | { type: "set-cfg"; value: AdminConfig | ((prev: AdminConfig) => AdminConfig) }
  | { type: "set-busy-id"; value: string }
  | { type: "set-err"; value: string }
  | {
      type: "set-collapsed";
      value:
        | Record<string, boolean>
        | ((prev: Record<string, boolean>) => Record<string, boolean>);
    }
  | {
      type: "set-open-admin";
      value:
        | Record<string, boolean>
        | ((prev: Record<string, boolean>) => Record<string, boolean>);
    }
  | {
      type: "set-access-choice";
      value:
        | Record<string, AccessKind>
        | ((prev: Record<string, AccessKind>) => Record<string, AccessKind>);
    }
  | { type: "set-batch-access"; value: AccessKind }
  | { type: "set-batch-password"; value: string }
  | { type: "set-batch-busy"; value: boolean }
  | { type: "set-collapsed-ready"; value: boolean }
  | { type: "set-render-limit"; value: number | ((prev: number) => number) };

function applyUpdater<T>(prev: T, next: T | ((prev: T) => T)): T {
  if (typeof next === "function") {
    return (next as (prev: T) => T)(prev);
  }
  return next;
}

export function createRouteExplorerInitialState(): RouteExplorerState {
  return {
    q: "",
    filter: "all",
    cfg: {
      overrides: {},
      protectedByPageId: {},
    },
    busyId: "",
    err: "",
    collapsed: {},
    openAdmin: {},
    accessChoice: {},
    batchAccess: "public",
    batchPassword: "",
    batchBusy: false,
    collapsedReady: false,
    renderLimit: INITIAL_RENDER_LIMIT,
  };
}

export function routeExplorerStateReducer(
  state: RouteExplorerState,
  action: Action,
): RouteExplorerState {
  switch (action.type) {
    case "set-q":
      return { ...state, q: action.value };
    case "set-filter":
      return { ...state, filter: action.value };
    case "set-cfg":
      return { ...state, cfg: applyUpdater(state.cfg, action.value) };
    case "set-busy-id":
      return { ...state, busyId: action.value };
    case "set-err":
      return { ...state, err: action.value };
    case "set-collapsed":
      return { ...state, collapsed: applyUpdater(state.collapsed, action.value) };
    case "set-open-admin":
      return { ...state, openAdmin: applyUpdater(state.openAdmin, action.value) };
    case "set-access-choice":
      return { ...state, accessChoice: applyUpdater(state.accessChoice, action.value) };
    case "set-batch-access":
      return { ...state, batchAccess: action.value };
    case "set-batch-password":
      return { ...state, batchPassword: action.value };
    case "set-batch-busy":
      return { ...state, batchBusy: action.value };
    case "set-collapsed-ready":
      return { ...state, collapsedReady: action.value };
    case "set-render-limit":
      return { ...state, renderLimit: applyUpdater(state.renderLimit, action.value) };
    default:
      return state;
  }
}

export type RouteExplorerSetters = {
  setQ: (value: string) => void;
  setFilter: (value: FilterKind) => void;
  setCfg: (value: AdminConfig | ((prev: AdminConfig) => AdminConfig)) => void;
  setBusyId: (value: string) => void;
  setErr: (value: string) => void;
  setCollapsed: (
    value:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  setOpenAdmin: (
    value:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  setAccessChoice: Dispatch<SetStateAction<Record<string, AccessKind>>>;
  setBatchAccess: (value: AccessKind) => void;
  setBatchPassword: (value: string) => void;
  setBatchBusy: (value: boolean) => void;
  setCollapsedReady: (value: boolean) => void;
  setRenderLimit: (value: number | ((prev: number) => number)) => void;
};

export function bindRouteExplorerSetters(
  dispatch: Dispatch<Action>,
): RouteExplorerSetters {
  return {
    setQ: (value) => dispatch({ type: "set-q", value }),
    setFilter: (value) => dispatch({ type: "set-filter", value }),
    setCfg: (value) => dispatch({ type: "set-cfg", value }),
    setBusyId: (value) => dispatch({ type: "set-busy-id", value }),
    setErr: (value) => dispatch({ type: "set-err", value }),
    setCollapsed: (value) => dispatch({ type: "set-collapsed", value }),
    setOpenAdmin: (value) => dispatch({ type: "set-open-admin", value }),
    setAccessChoice: (value) => dispatch({ type: "set-access-choice", value }),
    setBatchAccess: (value) => dispatch({ type: "set-batch-access", value }),
    setBatchPassword: (value) => dispatch({ type: "set-batch-password", value }),
    setBatchBusy: (value) => dispatch({ type: "set-batch-busy", value }),
    setCollapsedReady: (value) => dispatch({ type: "set-collapsed-ready", value }),
    setRenderLimit: (value) => dispatch({ type: "set-render-limit", value }),
  };
}
