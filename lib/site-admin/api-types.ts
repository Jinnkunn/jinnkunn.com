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
    storeKind: "local" | "github" | "db";
    repo: string | null;
    branch: string | null;
    headSha: string | null;
    headCommitTime: string | null;
    pendingDeploy: boolean | null;
    pendingDeployReason?: string | null;
    codeSha?: string | null;
    contentSha?: string | null;
    contentBranch?: string | null;
    deployableVersionReady?: boolean | null;
    deployableVersionReason?: string | null;
    deployableVersionId?: string | null;
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

// Publications + News + Teaching all migrated to inline blocks under
// content/pages/{publications,news,teaching}.mdx — their DTO types,
// `/api/site-admin/{...}` routes, and normalize layers are gone.
// Block-level data lives on MdxBlock fields.

// --- Teaching (term + course list) --------------------------------------

// Teaching migrated to inline `<TeachingEntry>` blocks in
// `content/pages/teaching.mdx`. The legacy DTO types
// (TeachingEntryDTO / SiteAdminTeachingData / get/post payloads) and
// `/api/site-admin/teaching` route are gone — entries ride the same
// MDX page-edit pipeline posts/pages already use.

// --- Works (projects / experiences grid) ---------------------------------

// Works migrated to inline `<WorksEntry>` blocks in
// `content/pages/works.mdx`. The legacy DTO types (WorksEntryDTO,
// SiteAdminWorksData, get/post payloads) and `/api/site-admin/works`
// route are gone — entries now ride the same MDX page-edit pipeline
// posts/pages already use.

// --- Home (section-based landing page) -----------------------------------

/** Home is now a single Notion-style MDX document — `bodyMdx` is the
 * only content source. The legacy section types
 * (SiteAdminHomeHeroSection, SiteAdminHomeLinkListSection, …) were
 * removed when the Notion-mode editor replaced the section-builder UI.
 * Any blocks the public site renders now flow through the shared MDX
 * components (HeroBlock / Columns / LinkListBlock / FeaturedPagesBlock /
 * paragraphs / headings / …) — same primitives every other page uses. */
export type SiteAdminHomeData = {
  schemaVersion?: number;
  title: string;
  bodyMdx?: string;
};

export type SiteAdminHomeGetPayload = {
  ok: true;
  data: SiteAdminHomeData;
  sourceVersion: { fileSha: string };
};

export type SiteAdminHomeGetResult = SiteAdminHomeGetPayload | SiteAdminApiError;

export type SiteAdminHomePostPayload = {
  ok: true;
  sourceVersion: { fileSha: string };
};

export type SiteAdminHomePostResult = SiteAdminHomePostPayload | SiteAdminApiError;

export type SiteAdminDeployPayload = {
  ok: true;
  triggeredAt: string;
  status: number;
  provider?: "generic" | "vercel" | "cloudflare" | "github-actions";
  deploymentId?: string;
  codeSha?: string;
  contentSha?: string;
  contentBranch?: string;
  // db-mode dispatch returns these so the UI can link the user to the
  // running build instead of pretending the worker promoted instantly.
  workflowEventType?: string;
  workflowRunsListUrl?: string;
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

export type SiteAdminDeployPreviewComponentChange = {
  name: string;
  label: string;
  sourcePath: string;
  embedTag: string;
  affectedRoutes: string[];
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
    componentsChanged: number;
  };
  samples: {
    pagesAdded: string[];
    pagesRemoved: string[];
    redirects: SiteAdminDeployPreviewRedirectChange[];
    protected: SiteAdminDeployPreviewProtectedChange[];
    components: SiteAdminDeployPreviewComponentChange[];
  };
};

export type SiteAdminDeployPreviewResult = SiteAdminDeployPreviewPayload | SiteAdminApiError;
