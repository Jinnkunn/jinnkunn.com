// Shared types for the site-admin surface.

/** Site-admin nav tab id — mirrors the leaf ids in `nav.ts` and the
 * surface switches on this value to pick which panel to render. Keep
 * the union in sync with `SECTIONS` when adding/removing tabs. */
export type SiteAdminTab =
  | "status"
  | "home"
  | "posts"
  | "pages"
  | "publications"
  | "teaching"
  | "works"
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

/** Selection state for the Posts/Pages list-detail shells. `null` → detail
 * column shows the empty-state; `{kind:"new"}` → create form; otherwise
 * the editor for `slug` is open. Shared between the containers and the
 * command palette so ⌘K can deep-link into a specific entry. */
export type ItemSelection =
  | null
  | { kind: "new"; initialSlug?: string }
  | { kind: "edit"; slug: string };

// --- Publications (structured editor) ------------------------------------

export interface PublicationProfileLink {
  label: string;
  href: string;
  hostname?: string;
}

export interface PublicationEntry {
  title: string;
  year: string;
  url: string;
  labels: string[];
  authors?: string[];
  doiUrl?: string;
  arxivUrl?: string;
  venue?: string;
  externalUrls?: string[];
}

export interface PublicationsData {
  schemaVersion?: number;
  title: string;
  description?: string;
  sections?: StructuredPageSection[];
  profileLinks: PublicationProfileLink[];
  entries: PublicationEntry[];
}

// --- Teaching (structured editor) ----------------------------------------

export interface TeachingLink {
  label: string;
  href: string;
}

export interface TeachingEntry {
  term: string;
  period: string;
  role: string;
  courseCode: string;
  courseName: string;
  courseUrl?: string;
  instructor?: string;
}

export interface TeachingData {
  schemaVersion?: number;
  title: string;
  description?: string;
  sections?: StructuredPageSection[];
  intro?: string;
  headerLinks: TeachingLink[];
  entries: TeachingEntry[];
  footerLinks: TeachingLink[];
}

// --- Works (structured editor) -------------------------------------------

export type WorksCategoryClient = "recent" | "passed";

export interface WorksEntry {
  category: WorksCategoryClient;
  role: string;
  affiliation?: string;
  affiliationUrl?: string;
  location?: string;
  period: string;
  description?: string;
}

export interface WorksData {
  schemaVersion?: number;
  title: string;
  description?: string;
  sections?: StructuredPageSection[];
  intro?: string;
  note?: string;
  entries: WorksEntry[];
}

// --- Home (section-based landing page) -----------------------------------

export type StructuredPageSectionType =
  | "intro"
  | "profileLinks"
  | "entries"
  | "recentWorks"
  | "passedWorks"
  | "note"
  | "headerLinks"
  | "footerLinks"
  | "richText";

export interface StructuredPageSection {
  id: string;
  type: StructuredPageSectionType;
  enabled: boolean;
  title?: string;
  body?: string;
  width: "narrow" | "standard" | "wide";
}

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
