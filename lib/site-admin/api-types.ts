import type { NavItemRow, SiteSettings } from "./types.ts";
import type { ProtectedAccessMode } from "../shared/access.ts";

export type SiteAdminApiError = { ok: false; error: string; code: string };

export type SiteAdminConfigSourceVersion = {
  siteConfigSha: string;
  branchSha: string;
};

export type SiteAdminRoutesSourceVersion = {
  siteConfigSha: string;
  protectedRoutesSha: string;
  branchSha: string;
};

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
    runtimeProvider: "local" | "vercel" | "cloudflare" | "unknown";
    runtimeRegion: string;
    hasDeployTarget: boolean;
    isVercel: boolean;
    vercelRegion: string;
    hasNotionToken: boolean;
    hasNotionAdminPageId: boolean;
    notionVersion: string;
    hasDeployHookUrl: boolean;
    hasNextAuthSecret: boolean;
    hasFlagsSecret: boolean;
    githubAllowlistCount: number;
    contentGithubAllowlistCount: number;
  };
  build: {
    provider: "local" | "vercel" | "cloudflare" | "unknown";
    commitSha: string;
    commitShort: string;
    branch: string;
    commitMessage: string;
    deploymentId: string;
    deploymentUrl: string;
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
  source: {
    storeKind: "local" | "github";
    repo: string | null;
    branch: string | null;
    headSha: string | null;
    headCommitTime: string | null;
    pendingDeploy: boolean | null;
    pendingDeployReason?: string | null;
    error?: string;
  };
  preflight?: {
    generatedFiles: {
      ok: boolean;
      expected: number;
      missingRoutes: string[];
    };
    routeOverrides: {
      ok: boolean;
      orphanPageIds: string[];
      duplicatePaths: string[];
    };
    navigation: {
      ok: boolean;
      invalidInternalHrefs: string[];
    };
    notionBlocks: {
      ok: boolean;
      unsupportedBlockCount: number;
      pagesWithUnsupported: number;
      sampleRoutes: string[];
    };
  };
  freshness?: {
    stale: boolean | null;
    syncMs: number | null;
    notionEditedMs: number | null;
    generatedLatestMs: number | null;
  };
  diagnostics?: SiteAdminDiagnostics;
};

export type SiteAdminDiagnosticsEvent = {
  at: string;
  severity: "warn" | "error";
  source: string;
  message: string;
  detail?: string;
};

export type SiteAdminDiagnostics = {
  total: number;
  warnCount: number;
  errorCount: number;
  oldestAt: string | null;
  newestAt: string | null;
  recent: SiteAdminDiagnosticsEvent[];
};

export type SiteAdminStatusResult = SiteAdminStatusPayload | SiteAdminApiError;

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
  auth: ProtectedAccessMode;
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
  sourceVersion: SiteAdminRoutesSourceVersion;
};

export type SiteAdminRoutesResult = SiteAdminRoutesGetPayload | SiteAdminApiError;

export type SiteAdminRoutesPostPayload = {
  ok: true;
  sourceVersion: SiteAdminRoutesSourceVersion;
  override?: SiteAdminRouteOverride;
  protected?: SiteAdminProtectedRoute;
};

export type SiteAdminRoutesPostResult = SiteAdminRoutesPostPayload | SiteAdminApiError;

export type SiteAdminConfigGetPayload = {
  ok: true;
  settings: SiteSettings | null;
  nav: NavItemRow[];
  sourceVersion: SiteAdminConfigSourceVersion;
};

export type SiteAdminConfigGetResult = SiteAdminConfigGetPayload | SiteAdminApiError;

export type SiteAdminConfigPostPayload = {
  ok: true;
  sourceVersion: SiteAdminConfigSourceVersion;
  created?: NavItemRow;
};

export type SiteAdminConfigPostResult = SiteAdminConfigPostPayload | SiteAdminApiError;

// --- Publications (structured editor data) -------------------------------

export type PublicationProfileLinkDTO = {
  label: string;
  href: string;
  hostname?: string;
};

export type PublicationAuthorDTO = {
  name: string;
  isSelf?: boolean;
};

export type PublicationVenueDTO = {
  type: string;
  text: string;
  url?: string;
};

export type PublicationEntryDTO = {
  title: string;
  year: string;
  url: string;
  labels: string[];
  authors?: string[];
  authorsRich?: PublicationAuthorDTO[];
  externalUrls?: string[];
  doiUrl?: string;
  arxivUrl?: string;
  venue?: string;
  venues?: PublicationVenueDTO[];
  highlights?: string[];
};

export type SiteAdminPublicationsData = {
  title: string;
  description?: string;
  profileLinks: PublicationProfileLinkDTO[];
  entries: PublicationEntryDTO[];
};

export type SiteAdminPublicationsGetPayload = {
  ok: true;
  data: SiteAdminPublicationsData;
  sourceVersion: { fileSha: string };
};

export type SiteAdminPublicationsGetResult =
  | SiteAdminPublicationsGetPayload
  | SiteAdminApiError;

export type SiteAdminPublicationsPostPayload = {
  ok: true;
  sourceVersion: { fileSha: string };
};

export type SiteAdminPublicationsPostResult =
  | SiteAdminPublicationsPostPayload
  | SiteAdminApiError;

// --- News (dated timeline) ----------------------------------------------

export type NewsEntryDTO = {
  dateIso: string; // YYYY-MM-DD
  body: string; // markdown (inline formatting + links)
};

export type SiteAdminNewsData = {
  title: string;
  description?: string;
  entries: NewsEntryDTO[];
};

export type SiteAdminNewsGetPayload = {
  ok: true;
  data: SiteAdminNewsData;
  sourceVersion: { fileSha: string };
};

export type SiteAdminNewsGetResult = SiteAdminNewsGetPayload | SiteAdminApiError;

export type SiteAdminNewsPostPayload = {
  ok: true;
  sourceVersion: { fileSha: string };
};

export type SiteAdminNewsPostResult = SiteAdminNewsPostPayload | SiteAdminApiError;

export type SiteAdminDeployPayload = {
  ok: true;
  triggeredAt: string;
  status: number;
  provider?: "generic" | "vercel" | "cloudflare";
  deploymentId?: string;
};

export type SiteAdminDeployResult = SiteAdminDeployPayload | SiteAdminApiError;

export type SiteAdminDeployPreviewRedirectChange = {
  kind: "added" | "removed" | "changed";
  source: "route" | "override" | "both";
  pageId: string;
  title: string;
  fromPath: string;
  toPath: string;
};

export type SiteAdminDeployPreviewProtectedChange = {
  kind: "added" | "removed" | "changed";
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  auth: ProtectedAccessMode;
  previousMode?: "exact" | "prefix";
  previousAuth?: ProtectedAccessMode;
};

export type SiteAdminDeployPreviewPayload = {
  ok: true;
  generatedAt: string;
  hasChanges: boolean;
  summary: {
    pagesAdded: number;
    pagesRemoved: number;
    redirectsAdded: number;
    redirectsRemoved: number;
    redirectsChanged: number;
    protectedAdded: number;
    protectedRemoved: number;
    protectedChanged: number;
  };
  samples: {
    pagesAdded: string[];
    pagesRemoved: string[];
    redirects: SiteAdminDeployPreviewRedirectChange[];
    protected: SiteAdminDeployPreviewProtectedChange[];
  };
};

export type SiteAdminDeployPreviewResult = SiteAdminDeployPreviewPayload | SiteAdminApiError;
