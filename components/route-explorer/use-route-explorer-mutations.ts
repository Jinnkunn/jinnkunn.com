"use client";

import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import {
  normalizeProtectedAccessMode,
  type AccessMode,
} from "@/lib/shared/access";
import type { AdminConfig } from "@/lib/site-admin/route-explorer-model";
import type { RouteTreeItem } from "@/lib/site-admin/route-explorer-types";

import { postAccess, postOverride } from "./api";

type AccessKind = AccessMode;

type MutationDeps = {
  setBusyId: (value: string) => void;
  setErr: (value: string) => void;
  setCfg: (value: AdminConfig | ((prev: AdminConfig) => AdminConfig)) => void;
};

export async function saveRouteOverride(
  deps: MutationDeps,
  pageId: string,
  routePath: string,
): Promise<void> {
  deps.setBusyId(pageId);
  deps.setErr("");
  try {
    await postOverride({ pageId, routePath });
    deps.setCfg((prev) => {
      const next = { ...prev, overrides: { ...prev.overrides } };
      const normalized = normalizeRoutePath(routePath);
      if (!normalized) delete next.overrides[pageId];
      else next.overrides[pageId] = normalized;
      return next;
    });
  } catch (e: unknown) {
    deps.setErr(e instanceof Error ? e.message : String(e));
  } finally {
    deps.setBusyId("");
  }
}

export async function applyRouteAccess(
  deps: MutationDeps,
  {
    pageId,
    path,
    access,
    password,
    trackBusy,
  }: {
    pageId: string;
    path: string;
    access: AccessKind;
    password?: string;
    trackBusy: boolean;
  },
): Promise<boolean> {
  if (trackBusy) deps.setBusyId(pageId);
  deps.setErr("");
  try {
    await postAccess({ pageId, path, access, password });
    deps.setCfg((prev) => {
      const next: AdminConfig = {
        overrides: prev.overrides,
        protectedByPageId: { ...prev.protectedByPageId },
      };
      const pid = compactId(pageId);
      const normalizedPath = normalizeRoutePath(path) || "/";

      if (access === "public") {
        delete next.protectedByPageId[pid];
        return next;
      }

      if (!pid) return next;
      const auth = normalizeProtectedAccessMode(access);
      next.protectedByPageId[pid] = { auth, mode: "prefix", path: normalizedPath };
      return next;
    });
    return true;
  } catch (e: unknown) {
    deps.setErr(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    if (trackBusy) deps.setBusyId("");
  }
}

export async function applyBatchRouteAccess(
  deps: MutationDeps,
  {
    routes,
    access,
    batchPassword,
  }: {
    routes: RouteTreeItem[];
    access: AccessKind;
    batchPassword: string;
  },
): Promise<{ success: number; total: number }> {
  const password = access === "password" ? batchPassword : "";
  let success = 0;
  for (const it of routes) {
    const ok = await applyRouteAccess(deps, {
      pageId: it.id,
      path: it.routePath,
      access,
      password,
      trackBusy: false,
    });
    if (ok) success += 1;
  }
  return { success, total: routes.length };
}
