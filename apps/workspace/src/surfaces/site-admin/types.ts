// Shared types for the site-admin surface.

/** Site-admin nav tab id — mirrors the leaf ids in `nav.ts` and the
 * surface switches on this value to pick which panel to render. Keep
 * the union in sync with `SECTIONS` when adding/removing tabs.
 * `components` is reachable only via the dynamic Components sub-tree
 * leaves — no static row maps to it directly. */
export type SiteAdminTab =
  | "status"
  | "home"
  | "posts"
  | "pages"
  | "components"
  | "links"
  | "settings";

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
    repo?: string | null;
    branch?: string | null;
    headSha?: string | null;
    headCommitTime?: string | null;
    pendingDeploy?: boolean | null;
    pendingDeployReason?: string;
    codeSha?: string | null;
    contentSha?: string | null;
    contentBranch?: string | null;
    deployableVersionReady?: boolean | null;
    deployableVersionReason?: string;
    deployableVersionId?: string;
  };
  deployments?: {
    active: null | {
      deploymentId?: string | null;
      versionId: string | null;
      createdOn: string | null;
      message: string | null;
      sourceSha: string | null;
      codeSha: string | null;
      contentSha: string | null;
      contentBranch: string | null;
    };
    latestUploaded: null | {
      versionId: string | null;
      createdOn: string | null;
      message: string | null;
      sourceSha: string | null;
      codeSha: string | null;
      contentSha: string | null;
      contentBranch: string | null;
    };
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

/** A named connection target — one per environment (Local, Staging,
 * Prod, …). Credentials (app token, CF Access pair) still live in the
 * system keyring keyed by `baseUrl`, so switching profiles picks up the
 * right token automatically. */
export interface ConnectionProfile {
  id: string;
  label: string;
  baseUrl: string;
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

/** Selection state for the Posts/Pages panels. `null` → empty state;
 * `{kind:"new"}` → create form; otherwise the editor for `slug` is open.
 * Shared between the containers and the command palette so ⌘K can
 * deep-link into a specific entry. */
export type ItemSelection =
  | null
  | { kind: "new"; initialSlug?: string }
  | { kind: "edit"; slug: string };

// Publications migrated to inline `<PublicationsEntry data='...' />`
// blocks inside the publications component source. Profile links are
// ordinary inline icon links in `content/pages/publications.mdx`.
// Block-level fields live on MdxBlock (`pubData`).

// Teaching migrated to inline `<TeachingEntry>` blocks inside
// `content/pages/teaching.mdx`. Fields live on MdxBlock (`teachingTerm`,
// `teachingPeriod`, etc.) instead of a separate DTO.

// Works migrated to inline `<WorksEntry>` blocks inside
// `content/pages/works.mdx`. Block-level types live in
// `mdx-blocks.ts` (the `worksCategory` / `worksRole` / etc. fields
// on MdxBlock).

// --- Home (section-based landing page) -----------------------------------

// StructuredPageSection types lived here while the news / works /
// teaching / publications panels iterated over a typed section list.
// They're gone now — every page in `content/pages/*.mdx` is a flat
// MDX document edited via the shared block editor.

/** Home is now a single MDX document — `bodyMdx` is the only content
 * source. The legacy section-builder schema (HomeHeroSection,
 * HomeLinkListSection, HomeLayoutSection, …) was removed once the
 * Notion-mode editor replaced the section-builder UI; the public site
 * renders bodyMdx through `postMdxComponents`, with the same
 * HeroBlock / LinkListBlock / FeaturedPagesBlock / Columns primitives
 * available on every other page. */
export interface HomeData {
  schemaVersion?: number;
  title: string;
  bodyMdx?: string;
}

// --- Assets ---------------------------------------------------------------

export interface AssetUploadResponse {
  key: string;
  url: string;
  size: number;
  contentType: string;
  version: string;
}
