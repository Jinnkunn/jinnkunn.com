import "server-only";

import {
  getSiteAdminSourceStore,
  type SiteAdminRoutesSourceVersion,
} from "@/lib/server/site-admin-source-store";
import type {
  SiteAdminRoutesSnapshot,
} from "@/lib/server/site-admin-source-store";
import type { ProtectedAccessMode } from "@/lib/shared/access";

export type SiteAdminRouteData = SiteAdminRoutesSnapshot;

export type OverrideUpsertResult = {
  rowId: string;
  pageId: string;
  routePath: string;
  enabled: true;
};

export type ProtectedUpsertResult = {
  rowId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  auth: ProtectedAccessMode;
  enabled: true;
};

const sourceStore = getSiteAdminSourceStore();

export async function loadSiteAdminRouteData(): Promise<SiteAdminRouteData> {
  return sourceStore.loadRoutes();
}

export async function upsertOverride(input: {
  pageId: string;
  routePath: string;
  expectedSiteConfigSha: string;
}): Promise<{ override: OverrideUpsertResult; sourceVersion: SiteAdminRoutesSourceVersion }> {
  const sourceVersion = await sourceStore.updateOverride({
    pageId: input.pageId,
    routePath: input.routePath,
    expectedSiteConfigSha: input.expectedSiteConfigSha,
  });
  return {
    override: {
      rowId: input.pageId,
      pageId: input.pageId,
      routePath: input.routePath,
      enabled: true,
    },
    sourceVersion,
  };
}

export async function disableOverride(input: {
  pageId: string;
  expectedSiteConfigSha: string;
}): Promise<SiteAdminRoutesSourceVersion> {
  return sourceStore.updateOverride({
    pageId: input.pageId,
    routePath: "",
    expectedSiteConfigSha: input.expectedSiteConfigSha,
  });
}

export async function upsertProtected(input: {
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  password: string;
  auth: ProtectedAccessMode;
  expectedProtectedRoutesSha: string;
}): Promise<{ protected: ProtectedUpsertResult; sourceVersion: SiteAdminRoutesSourceVersion }> {
  const sourceVersion = await sourceStore.updateProtected({
    pageId: input.pageId,
    path: input.path,
    mode: input.mode,
    password: input.password,
    auth: input.auth,
    expectedProtectedRoutesSha: input.expectedProtectedRoutesSha,
  });
  return {
    protected: {
      rowId: input.pageId || input.path,
      pageId: input.pageId,
      path: input.path,
      mode: input.mode,
      auth: input.auth,
      enabled: true,
    },
    sourceVersion,
  };
}

export async function disableProtected(input: {
  pageId: string;
  path: string;
  expectedProtectedRoutesSha: string;
}): Promise<SiteAdminRoutesSourceVersion> {
  return sourceStore.updateProtected({
    pageId: input.pageId,
    path: input.path,
    mode: "prefix",
    auth: "password",
    password: "",
    delete: true,
    expectedProtectedRoutesSha: input.expectedProtectedRoutesSha,
  });
}
