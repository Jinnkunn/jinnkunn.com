import "server-only";

import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";
import { notionRichText, normalizeHttpUrl, redactUrlQueryParams } from "@/lib/server/notion-format";

export function buildSiteSettingsProperties(
  patch: Partial<Omit<SiteSettings, "rowId">>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (patch.siteName !== undefined) properties["Site Name"] = { rich_text: notionRichText(patch.siteName) };
  if (patch.lang !== undefined) properties["Lang"] = { select: { name: patch.lang || "en" } };
  if (patch.seoTitle !== undefined) properties["SEO Title"] = { rich_text: notionRichText(patch.seoTitle) };
  if (patch.seoDescription !== undefined) properties["SEO Description"] = { rich_text: notionRichText(patch.seoDescription) };
  if (patch.favicon !== undefined) properties["Favicon"] = { rich_text: notionRichText(patch.favicon) };
  if (patch.ogImage !== undefined) properties["OG Image"] = { rich_text: notionRichText(patch.ogImage) };
  if (patch.googleAnalyticsId !== undefined) properties["Google Analytics ID"] = { rich_text: notionRichText(patch.googleAnalyticsId) };
  if (patch.contentGithubUsers !== undefined) properties["Content GitHub Users"] = { rich_text: notionRichText(patch.contentGithubUsers) };
  if (patch.sitemapExcludes !== undefined) properties["Sitemap Excludes"] = { rich_text: notionRichText(patch.sitemapExcludes) };
  if (patch.rootPageId !== undefined) properties["Root Page ID"] = { rich_text: notionRichText(patch.rootPageId) };
  if (patch.homePageId !== undefined) properties["Home Page ID"] = { rich_text: notionRichText(patch.homePageId) };
  return properties;
}

export function buildNavProperties(
  patch: Partial<Omit<NavItemRow, "rowId">>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (patch.label !== undefined) properties["Label"] = { title: notionRichText(patch.label) };
  if (patch.href !== undefined) properties["Href"] = { rich_text: notionRichText(patch.href) };
  if (patch.group !== undefined) properties["Group"] = { select: { name: patch.group === "top" ? "top" : "more" } };
  if (patch.order !== undefined) properties["Order"] = { number: Number.isFinite(patch.order) ? patch.order : 0 };
  if (patch.enabled !== undefined) properties["Enabled"] = { checkbox: Boolean(patch.enabled) };
  return properties;
}

export function buildNavCreateProperties(
  input: Omit<NavItemRow, "rowId">,
): Record<string, unknown> {
  return {
    Label: { title: notionRichText(input.label) },
    Href: { rich_text: notionRichText(input.href) },
    Group: { select: { name: input.group === "top" ? "top" : "more" } },
    Order: { number: Number.isFinite(input.order) ? input.order : 0 },
    Enabled: { checkbox: Boolean(input.enabled) },
  };
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
  auth: "password" | "github";
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
  const properties: Record<string, unknown> = {
    Name: { title: notionRichText(buildDeployLogName(input.triggeredAtIso)) },
    "Triggered At": { date: { start: input.triggeredAtIso } },
    Result: { select: { name: String(input.result || "").trim() || "Triggered" } },
  };

  if (typeof input.httpStatus === "number" && Number.isFinite(input.httpStatus)) {
    properties["HTTP Status"] = { number: input.httpStatus };
  }

  const reqUrl = String(input.requestUrl || "").trim();
  if (reqUrl) {
    properties.Request = { url: redactUrlQueryParams(reqUrl, ["token"]) };
  }

  const msg = String(input.message || "").trim();
  if (msg) {
    properties.Message = { rich_text: notionRichText(msg.slice(0, 1800)) };
  }

  const lastEvent = String(input.lastEvent || "").trim();
  if (lastEvent) {
    properties["Last Event"] = { rich_text: notionRichText(lastEvent) };
  }

  const deploymentId = String(input.deploymentId || "").trim();
  if (deploymentId) {
    properties["Deployment ID"] = { rich_text: notionRichText(deploymentId) };
  }

  const deploymentUrl = String(input.deploymentUrl || "").trim();
  if (deploymentUrl) {
    properties.Deployment = { url: normalizeHttpUrl(deploymentUrl) };
  }

  const dashboardUrl = String(input.dashboardUrl || "").trim();
  if (dashboardUrl) {
    properties.Dashboard = { url: normalizeHttpUrl(dashboardUrl) };
  }

  const target = String(input.target || "").trim();
  if (target) {
    properties.Target = { select: { name: target } };
  }

  return properties;
}

export function buildDeployLogUpdateProperties(
  input: Omit<DeployLogRowInput, "triggeredAtIso" | "httpStatus" | "requestUrl" | "message">,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    Result: { select: { name: String(input.result || "").trim() || "Building" } },
  };

  const lastEvent = String(input.lastEvent || "").trim();
  if (lastEvent) {
    properties["Last Event"] = { rich_text: notionRichText(lastEvent) };
  }

  const deploymentId = String(input.deploymentId || "").trim();
  if (deploymentId) {
    properties["Deployment ID"] = { rich_text: notionRichText(deploymentId) };
  }

  const deploymentUrl = String(input.deploymentUrl || "").trim();
  if (deploymentUrl) {
    properties.Deployment = { url: normalizeHttpUrl(deploymentUrl) };
  }

  const dashboardUrl = String(input.dashboardUrl || "").trim();
  if (dashboardUrl) {
    properties.Dashboard = { url: normalizeHttpUrl(dashboardUrl) };
  }

  const target = String(input.target || "").trim();
  if (target) {
    properties.Target = { select: { name: target } };
  }

  return properties;
}
