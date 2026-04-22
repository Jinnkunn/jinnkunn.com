"use client";

import type { Dispatch, SetStateAction } from "react";

import { isRequestJsonError } from "@/lib/client/request-json";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import {
  normalizeProtectedAccessMode,
  type AccessMode,
} from "@/lib/shared/access";
import type { SiteAdminSourceVersion } from "@/lib/site-admin/api-types";
import type { AdminConfig } from "@/lib/site-admin/route-explorer-model";
import type { RouteTreeItem } from "@/lib/site-admin/route-explorer-types";
import type { SiteAdminEditorResultState } from "@/lib/site-admin/editor-state";
import { mapEditorErrorToResult } from "@/lib/site-admin/editor-state";

import { postAccess, postOverride } from "./api";

type AccessKind = AccessMode;

type MutationDeps = {
  setBusyId: (value: string) => void;
  setErr: (value: string) => void;
  setCfg: (value: AdminConfig | ((prev: AdminConfig) => AdminConfig)) => void;
  setEditorResult: Dispatch<SetStateAction<SiteAdminEditorResultState>>;
};

export async function saveRouteOverride(
  deps: MutationDeps,
  expectedSiteConfigSha: string,
  pageId: string,
  routePath: string,
): Promise<boolean> {
  deps.setBusyId(pageId);
  deps.setErr("");
  deps.setEditorResult({
    kind: "saving",
    message: "Saving route override to GitHub main...",
  });
  try {
    const sourceVersion = await postOverride({
      pageId,
      routePath,
      expectedSiteConfigSha,
    });
    deps.setCfg((prev) => {
      const next = { ...prev, sourceVersion, overrides: { ...prev.overrides } };
      const normalized = normalizeRoutePath(routePath);
      if (!normalized) delete next.overrides[pageId];
      else next.overrides[pageId] = normalized;
      return next;
    });
    deps.setEditorResult({
      kind: "saved",
      message: "Route override saved to GitHub main. Deploy to publish it.",
    });
    return true;
  } catch (e: unknown) {
    deps.setEditorResult(
      mapEditorErrorToResult({
        code: isRequestJsonError(e) ? e.code : undefined,
        message: e instanceof Error ? e.message : String(e),
        conflictMessage: "Source changed on GitHub. Reload latest before saving route overrides again.",
      }),
    );
    return false;
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
    expectedProtectedRoutesSha,
    trackBusy,
    trackEditorResult,
  }: {
    pageId: string;
    path: string;
    access: AccessKind;
    password?: string;
    expectedProtectedRoutesSha: string;
    trackBusy: boolean;
    trackEditorResult: boolean;
  },
): Promise<
  | { ok: true; sourceVersion: SiteAdminSourceVersion }
  | { ok: false; code?: string; message: string }
> {
  if (trackBusy) deps.setBusyId(pageId);
  deps.setErr("");
  if (trackEditorResult) {
    deps.setEditorResult({
      kind: "saving",
      message: "Saving route access to GitHub main...",
    });
  }
  try {
    const sourceVersion = await postAccess({
      pageId,
      path,
      access,
      password,
      expectedProtectedRoutesSha,
    });
    deps.setCfg((prev) => {
      const next: AdminConfig = {
        sourceVersion,
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
    if (trackEditorResult) {
      deps.setEditorResult({
        kind: "saved",
        message: "Route access saved to GitHub main. Deploy to publish it.",
      });
    }
    return { ok: true, sourceVersion };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const code = isRequestJsonError(e) ? e.code : undefined;
    if (trackEditorResult) {
      deps.setEditorResult(
        mapEditorErrorToResult({
          code,
          message,
          conflictMessage: "Source changed on GitHub. Reload latest before saving route access again.",
        }),
      );
    }
    return { ok: false, code, message };
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
    expectedProtectedRoutesSha,
  }: {
    routes: RouteTreeItem[];
    access: AccessKind;
    batchPassword: string;
    expectedProtectedRoutesSha: string;
  },
): Promise<{
  success: number;
  total: number;
  appliedPageIds: string[];
  interruptedByConflict: boolean;
  errorMessage: string;
}> {
  const password = access === "password" ? batchPassword : "";
  let success = 0;
  let currentExpectedSha = expectedProtectedRoutesSha;
  const appliedPageIds: string[] = [];
  for (const it of routes) {
    const result = await applyRouteAccess(deps, {
      pageId: it.id,
      path: it.routePath,
      access,
      password,
      expectedProtectedRoutesSha: currentExpectedSha,
      trackBusy: false,
      trackEditorResult: false,
    });
    if (result.ok) {
      success += 1;
      appliedPageIds.push(it.id);
      currentExpectedSha = result.sourceVersion.protectedRoutesSha;
      continue;
    }
    return {
      success,
      total: routes.length,
      appliedPageIds,
      interruptedByConflict: result.code === "SOURCE_CONFLICT",
      errorMessage: result.message,
    };
  }
  return {
    success,
    total: routes.length,
    appliedPageIds,
    interruptedByConflict: false,
    errorMessage: "",
  };
}
