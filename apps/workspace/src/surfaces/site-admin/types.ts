// Shared types for the site-admin surface.

export interface SiteSettings {
  rowId: string;
  siteName: string;
  lang: string;
  seoTitle: string;
  seoDescription: string;
  favicon: string;
  ogImage: string;
  seoPageOverrides: string;
  googleAnalyticsId: string;
  contentGithubUsers: string;
  sitemapExcludes: string;
  sitemapAutoExcludeEnabled: boolean;
  sitemapAutoExcludeSections: string;
  sitemapAutoExcludeDepthPages: string;
  sitemapAutoExcludeDepthBlog: string;
  sitemapAutoExcludeDepthPublications: string;
  sitemapAutoExcludeDepthTeaching: string;
  rootPageId: string;
  homePageId: string;
}

export interface NavRow {
  rowId: string;
  label: string;
  href: string;
  group: "top" | "more";
  order: number;
  enabled: boolean;
}

export interface OverrideRow {
  rowId: string;
  pageId: string;
  routePath: string;
  enabled: boolean;
}

export interface ProtectedRow {
  rowId: string;
  pageId: string;
  path: string;
  mode: string;
  auth: "password" | "github" | "public";
  /** Client-side edit buffer; never populated from server response. */
  password: string;
  enabled: boolean;
}

export interface ConfigSourceVersion {
  siteConfigSha: string;
  branchSha: string;
}

export interface RoutesSourceVersion {
  siteConfigSha: string;
  protectedRoutesSha: string;
  branchSha: string;
}

export interface StatusPayload {
  source: {
    storeKind?: string;
    branch?: string;
    headSha?: string;
    pendingDeploy?: boolean;
    pendingDeployReason?: string;
  };
  env: {
    runtimeProvider?: string;
    hasDeployTarget?: boolean;
  };
  build: unknown;
}

export type MessageKind = "" | "info" | "success" | "warn" | "error";

export interface MessageState {
  kind: MessageKind;
  text: string;
}

export interface ConnectionState {
  baseUrl: string;
  authToken: string;
  authLogin: string;
  authExpiresAt: string;
  authLoading: boolean;
  /** Cloudflare Access service-token Client ID (e.g. "<hex>.access").
   * When present together with the secret, it's attached as
   * CF-Access-Client-Id on every API request. */
  cfAccessClientId: string;
  /** Cloudflare Access service-token Client Secret. Persisted in the
   * system keyring, never in localStorage. */
  cfAccessClientSecret: string;
}

export interface NormalizedApiSuccess {
  ok: true;
  status: number;
  data: unknown;
  raw: unknown;
}

export interface NormalizedApiFailure {
  ok: false;
  status: number;
  code: string;
  error: string;
  raw: unknown;
}

export type NormalizedApiResponse = NormalizedApiSuccess | NormalizedApiFailure;

// --- MDX content (posts + pages) ------------------------------------------

export interface PostListRow {
  slug: string;
  href: string;
  title: string;
  dateIso: string | null;
  dateText: string | null;
  description: string | null;
  draft: boolean;
  tags: string[];
  wordCount: number;
  readingMinutes: number;
  version: string;
}

export interface PostDetail extends PostListRow {
  source: string;
}

export interface PageListRow {
  slug: string;
  href: string;
  title: string;
  description: string | null;
  updatedIso: string | null;
  draft: boolean;
  wordCount: number;
  readingMinutes: number;
  version: string;
}

export interface PageDetail extends PageListRow {
  source: string;
}

// --- Assets ---------------------------------------------------------------

export interface AssetUploadResponse {
  key: string;
  url: string;
  size: number;
  contentType: string;
  version: string;
}
