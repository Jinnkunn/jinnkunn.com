import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";

export type SiteAdminStat = {
  exists: boolean;
  mtimeMs?: number;
  size?: number;
  count?: number;
};

export type SiteAdminSyncMeta = null | {
  syncedAt: string;
  notionVersion?: string;
  adminPageId?: string;
  rootPageId?: string;
  homePageId?: string;
  homeTitle?: string;
  pages?: number;
  routes?: number;
  routeOverrides?: number;
  protectedRules?: number;
};

export type SiteAdminStatusPayload = {
  ok: true;
  env: {
    nodeEnv: string;
    isVercel: boolean;
    vercelRegion: string;
    hasNotionToken: boolean;
    hasNotionAdminPageId: boolean;
    notionVersion: string;
    hasDeployHookUrl: boolean;
    hasNextAuthSecret: boolean;
    githubAllowlistCount: number;
    contentGithubAllowlistCount: number;
  };
  build: {
    commitSha: string;
    commitShort: string;
    branch: string;
    commitMessage: string;
    deploymentId: string;
    vercelUrl: string;
  };
  content: {
    siteName: string;
    nav: { top: number; more: number };
    routesDiscovered: number;
    searchIndexItems: number | null;
    syncMeta: SiteAdminSyncMeta;
  };
  files: {
    siteConfig: SiteAdminStat;
    routesManifest: SiteAdminStat;
    protectedRoutes: SiteAdminStat;
    syncMeta: SiteAdminStat;
    searchIndex: SiteAdminStat;
    routesJson: SiteAdminStat;
    notionSyncCache: SiteAdminStat;
  };
  notion: {
    adminPage: null | { id: string; lastEdited: string; title: string };
    rootPage: null | { id: string; lastEdited: string; title: string };
  };
  freshness?: {
    stale: boolean | null;
    syncMs: number | null;
    notionEditedMs: number | null;
    generatedLatestMs: number | null;
  };
};

export type SiteAdminStatusResult = SiteAdminStatusPayload | { ok: false; error: string };

export type SiteAdminRouteOverride = {
  rowId: string;
  pageId: string;
  routePath: string;
  enabled: true;
};

export type SiteAdminProtectedRoute = {
  rowId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  auth: "password" | "github";
  enabled: true;
};

export type SiteAdminRoutesGetPayload = {
  ok: true;
  adminPageId: string;
  databases: {
    overridesDbId: string;
    protectedDbId: string;
  };
  overrides: SiteAdminRouteOverride[];
  protectedRoutes: SiteAdminProtectedRoute[];
};

export type SiteAdminRoutesResult = SiteAdminRoutesGetPayload | { ok: false; error: string };

export type SiteAdminConfigGetPayload = {
  ok: true;
  settings: SiteSettings | null;
  nav: NavItemRow[];
};

export type SiteAdminConfigGetResult = SiteAdminConfigGetPayload | { ok: false; error: string };

export type SiteAdminConfigPostPayload = {
  ok: true;
  created?: NavItemRow;
};

export type SiteAdminConfigPostResult = SiteAdminConfigPostPayload | { ok: false; error: string };

export type SiteAdminDeployPayload = {
  ok: true;
  triggeredAt: string;
  status: number;
};

export type SiteAdminDeployResult = SiteAdminDeployPayload | { ok: false; error: string };
