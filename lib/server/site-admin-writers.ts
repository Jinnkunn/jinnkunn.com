import "server-only";

import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";
import type { ProtectedAccessMode } from "@/lib/shared/access";
import { parseDepthNumber } from "@/lib/shared/depth";
import { notionRichText, normalizeHttpUrl, redactUrlQueryParams } from "@/lib/server/notion-format";

type NotionPropertyMap = Record<string, unknown>;

type PropertySpec<T extends Record<string, unknown>> = {
  field: keyof T;
  notionProperty: string;
  build: (value: unknown, source: T) => unknown;
};

type SiteSettingsPatch = Partial<Omit<SiteSettings, "rowId">>;
type NavWritableInput = Partial<Omit<NavItemRow, "rowId">>;

function propertySpec<T extends Record<string, unknown>, K extends keyof T>(
  field: K,
  notionProperty: string,
  build: (value: T[K], source: T) => unknown,
): PropertySpec<T> {
  return {
    field,
    notionProperty,
    build: (value, source) => build(value as T[K], source),
  };
}

function buildPropertiesFromSpecs<T extends Record<string, unknown>>(
  source: T,
  specs: Array<PropertySpec<T>>,
): NotionPropertyMap {
  const out: NotionPropertyMap = {};
  for (const spec of specs) {
    const value = source[spec.field];
    if (value === undefined) continue;
    out[spec.notionProperty] = spec.build(value, source);
  }
  return out;
}

function appendIfPresent(
  out: NotionPropertyMap,
  key: string,
  value: unknown,
  build: (value: unknown) => unknown,
): void {
  if (value === undefined || value === null) return;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (typeof normalized === "string" && !normalized) return;
  out[key] = build(normalized);
}

function toSafeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function titleProperty(value: unknown): { title: ReturnType<typeof notionRichText> } {
  return { title: notionRichText(String(value ?? "")) };
}

function richTextProperty(value: unknown): { rich_text: ReturnType<typeof notionRichText> } {
  return { rich_text: notionRichText(String(value ?? "")) };
}

function checkboxProperty(value: unknown): { checkbox: boolean } {
  return { checkbox: Boolean(value) };
}

function numberProperty(value: unknown, fallback = 0): { number: number } {
  return { number: toSafeNumber(value, fallback) };
}

function selectProperty(name: string): { select: { name: string } } {
  return { select: { name } };
}

const SITE_SETTINGS_PROPERTY_SPECS: Array<PropertySpec<SiteSettingsPatch>> = [
  propertySpec("siteName", "Site Name", (value) => richTextProperty(value)),
  propertySpec("lang", "Lang", (value) => selectProperty(String(value || "en") || "en")),
  propertySpec("seoTitle", "SEO Title", (value) => richTextProperty(value)),
  propertySpec("seoDescription", "SEO Description", (value) => richTextProperty(value)),
  propertySpec("favicon", "Favicon", (value) => richTextProperty(value)),
  propertySpec("ogImage", "OG Image", (value) => richTextProperty(value)),
  propertySpec("googleAnalyticsId", "Google Analytics ID", (value) => richTextProperty(value)),
  propertySpec("contentGithubUsers", "Content GitHub Users", (value) => richTextProperty(value)),
  propertySpec("sitemapExcludes", "Sitemap Excludes", (value) => richTextProperty(value)),
  propertySpec("sitemapAutoExcludeEnabled", "Sitemap Auto Exclude Enabled", (value) => checkboxProperty(value)),
  propertySpec("sitemapAutoExcludeSections", "Sitemap Auto Exclude Sections", (value) =>
    richTextProperty(value)
  ),
  propertySpec("sitemapAutoExcludeDepthPages", "Sitemap Max Depth Pages", (value) => ({ number: parseDepthNumber(value) })),
  propertySpec("sitemapAutoExcludeDepthBlog", "Sitemap Max Depth Blog", (value) => ({ number: parseDepthNumber(value) })),
  propertySpec("sitemapAutoExcludeDepthPublications", "Sitemap Max Depth Publications", (value) => ({
    number: parseDepthNumber(value),
  })),
  propertySpec("sitemapAutoExcludeDepthTeaching", "Sitemap Max Depth Teaching", (value) => ({ number: parseDepthNumber(value) })),
  propertySpec("rootPageId", "Root Page ID", (value) => richTextProperty(value)),
  propertySpec("homePageId", "Home Page ID", (value) => richTextProperty(value)),
];

const NAV_PROPERTY_SPECS: Array<PropertySpec<NavWritableInput>> = [
  propertySpec("label", "Label", (value) => titleProperty(value)),
  propertySpec("href", "Href", (value) => richTextProperty(value)),
  propertySpec("group", "Group", (value) => selectProperty(value === "top" ? "top" : "more")),
  propertySpec("order", "Order", (value) => numberProperty(value, 0)),
  propertySpec("enabled", "Enabled", (value) => checkboxProperty(value)),
];

export function buildSiteSettingsProperties(
  patch: SiteSettingsPatch,
): Record<string, unknown> {
  return buildPropertiesFromSpecs(patch, SITE_SETTINGS_PROPERTY_SPECS);
}

function buildNavWritableProperties(input: NavWritableInput): Record<string, unknown> {
  return buildPropertiesFromSpecs(input, NAV_PROPERTY_SPECS);
}

export function buildNavProperties(
  patch: Partial<Omit<NavItemRow, "rowId">>,
): Record<string, unknown> {
  return buildNavWritableProperties(patch);
}

export function buildNavCreateProperties(
  input: Omit<NavItemRow, "rowId">,
): Record<string, unknown> {
  return buildNavWritableProperties(input);
}

export function buildRouteOverrideProperties(
  pageId: string,
  routePath: string,
): Record<string, unknown> {
  return {
    Name: { title: notionRichText(routePath) },
    "Page ID": { rich_text: notionRichText(pageId) },
    "Route Path": { rich_text: notionRichText(routePath) },
    Enabled: { checkbox: true },
  };
}

export function buildProtectedRouteProperties(input: {
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  auth: ProtectedAccessMode;
  password?: string;
}): Record<string, unknown> {
  const pwd = String(input.password || "").trim();
  return {
    Name: { title: notionRichText(input.path) },
    "Page ID": { rich_text: notionRichText(input.pageId) },
    Path: { rich_text: notionRichText(input.path) },
    Mode: { select: { name: input.mode } },
    Auth: { select: { name: input.auth === "github" ? "GitHub" : "Password" } },
    Password: { rich_text: input.auth === "password" ? notionRichText(pwd) : [] },
    Enabled: { checkbox: true },
  };
}

export function buildEnabledOnlyProperties(enabled: boolean): Record<string, unknown> {
  return { Enabled: { checkbox: Boolean(enabled) } };
}

type DeployLogRowInput = {
  triggeredAtIso: string;
  result: string;
  httpStatus?: number | null;
  requestUrl?: string;
  message?: string;
  lastEvent?: string;
  deploymentId?: string;
  deploymentUrl?: string;
  dashboardUrl?: string;
  target?: string;
};

export function buildDeployLogName(triggeredAtIso: string): string {
  return `Deploy @ ${triggeredAtIso.replace("T", " ").replace("Z", " UTC")}`;
}

export function buildDeployLogCreateProperties(input: DeployLogRowInput): Record<string, unknown> {
  const properties: NotionPropertyMap = {
    Name: { title: notionRichText(buildDeployLogName(input.triggeredAtIso)) },
    "Triggered At": { date: { start: input.triggeredAtIso } },
    Result: { select: { name: String(input.result || "").trim() || "Triggered" } },
  };

  appendIfPresent(properties, "HTTP Status", input.httpStatus, (v) =>
    ({ number: toSafeNumber(v, 0) }),
  );
  appendIfPresent(properties, "Request", input.requestUrl, (v) =>
    ({ url: redactUrlQueryParams(String(v), ["token"]) }),
  );
  appendIfPresent(properties, "Message", input.message, (v) =>
    ({ rich_text: notionRichText(String(v).slice(0, 1800)) }),
  );
  appendIfPresent(properties, "Last Event", input.lastEvent, (v) =>
    ({ rich_text: notionRichText(String(v)) }),
  );
  appendIfPresent(properties, "Deployment ID", input.deploymentId, (v) =>
    ({ rich_text: notionRichText(String(v)) }),
  );
  appendIfPresent(properties, "Deployment", input.deploymentUrl, (v) =>
    ({ url: normalizeHttpUrl(String(v)) }),
  );
  appendIfPresent(properties, "Dashboard", input.dashboardUrl, (v) =>
    ({ url: normalizeHttpUrl(String(v)) }),
  );
  appendIfPresent(properties, "Target", input.target, (v) =>
    ({ select: { name: String(v) } }),
  );

  return properties;
}

export function buildDeployLogUpdateProperties(
  input: Omit<DeployLogRowInput, "triggeredAtIso" | "httpStatus" | "requestUrl" | "message">,
): Record<string, unknown> {
  const properties: NotionPropertyMap = {
    Result: { select: { name: String(input.result || "").trim() || "Building" } },
  };

  appendIfPresent(properties, "Last Event", input.lastEvent, (v) =>
    ({ rich_text: notionRichText(String(v)) }),
  );
  appendIfPresent(properties, "Deployment ID", input.deploymentId, (v) =>
    ({ rich_text: notionRichText(String(v)) }),
  );
  appendIfPresent(properties, "Deployment", input.deploymentUrl, (v) =>
    ({ url: normalizeHttpUrl(String(v)) }),
  );
  appendIfPresent(properties, "Dashboard", input.dashboardUrl, (v) =>
    ({ url: normalizeHttpUrl(String(v)) }),
  );
  appendIfPresent(properties, "Target", input.target, (v) =>
    ({ select: { name: String(v) } }),
  );

  return properties;
}
