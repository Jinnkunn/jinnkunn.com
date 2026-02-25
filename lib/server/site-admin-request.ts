import "server-only";

import { compactId } from "@/lib/shared/route-utils";
import {
  parseSiteAdminRoutesCommand,
  type SiteAdminRoutesCommand,
} from "@/lib/site-admin/routes-command";
import type { ParseResult } from "@/lib/site-admin/request-types";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";
import {
  getBoolean,
  getEnum,
  getNumber,
  getString,
  isObject,
  readJsonBody,
} from "@/lib/server/validate";

export type SiteAdminSettingsPatch = Partial<Omit<SiteSettings, "rowId">>;
export type SiteAdminNavPatch = Partial<Omit<NavItemRow, "rowId">>;
export type SiteAdminNavCreateInput = Omit<NavItemRow, "rowId">;

function depthFieldFromUnknown(
  patch: Record<string, unknown>,
  key: string,
): string {
  if (!(key in patch)) return "";
  const raw = patch[key];
  if (raw === null || raw === undefined) return "";
  const n = Number(typeof raw === "string" ? raw.trim() : raw);
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, Math.min(20, Math.floor(n))));
}

export type SiteAdminConfigCommand =
  | { kind: "settings"; rowId: string; patch: SiteAdminSettingsPatch }
  | { kind: "nav-update"; rowId: string; patch: SiteAdminNavPatch }
  | { kind: "nav-create"; input: SiteAdminNavCreateInput };

function bad(error: string, status = 400): ParseResult<never> {
  return { ok: false, error, status };
}

type ParseJsonCommandOptions = {
  invalidJsonError?: string;
  invalidJsonStatus?: number;
};

export async function parseSiteAdminJsonCommand<T>(
  req: Request,
  parseBody: (body: Record<string, unknown>) => ParseResult<T>,
  opts?: ParseJsonCommandOptions,
): Promise<ParseResult<T>> {
  const body = await readJsonBody(req);
  if (!body) {
    return bad(opts?.invalidJsonError || "Invalid JSON", opts?.invalidJsonStatus ?? 400);
  }
  return parseBody(body);
}

export function parseSiteAdminConfigCommand(
  body: Record<string, unknown>,
): ParseResult<SiteAdminConfigCommand> {
  const kind = getEnum(
    body,
    "kind",
    ["settings", "nav-update", "nav-create"] as const,
    "",
  );
  if (!kind) return bad("Unknown kind", 400);

  if (kind === "settings") {
    const rowId = compactId(getString(body, "rowId"));
    if (!rowId) return bad("Missing rowId", 400);

    const patch = isObject(body.patch) ? body.patch : {};
    const outPatch: SiteAdminSettingsPatch = {};

    if (patch.siteName !== undefined) {
      outPatch.siteName = getString(patch, "siteName", { maxLen: 240 });
    }
    if (patch.lang !== undefined) {
      outPatch.lang = getString(patch, "lang", { maxLen: 24 }) || "en";
    }
    if (patch.seoTitle !== undefined) {
      outPatch.seoTitle = getString(patch, "seoTitle", { maxLen: 300 });
    }
    if (patch.seoDescription !== undefined) {
      outPatch.seoDescription = getString(patch, "seoDescription", { maxLen: 800 });
    }
    if (patch.favicon !== undefined) {
      outPatch.favicon = getString(patch, "favicon", { maxLen: 500 });
    }
    if (patch.ogImage !== undefined) {
      outPatch.ogImage = getString(patch, "ogImage", { maxLen: 1000 });
    }
    if (patch.googleAnalyticsId !== undefined) {
      outPatch.googleAnalyticsId = getString(patch, "googleAnalyticsId", { maxLen: 64 });
    }
    if (patch.contentGithubUsers !== undefined) {
      outPatch.contentGithubUsers = getString(patch, "contentGithubUsers", { maxLen: 800 });
    }
    if (patch.sitemapExcludes !== undefined) {
      outPatch.sitemapExcludes = getString(patch, "sitemapExcludes", { maxLen: 3000 });
    }
    if (patch.sitemapAutoExcludeEnabled !== undefined) {
      const enabled = getBoolean(patch, "sitemapAutoExcludeEnabled");
      outPatch.sitemapAutoExcludeEnabled = enabled ?? true;
    }
    if (patch.sitemapAutoExcludeSections !== undefined) {
      outPatch.sitemapAutoExcludeSections = getString(patch, "sitemapAutoExcludeSections", {
        maxLen: 400,
      });
    }
    if (patch.sitemapAutoExcludeDepthPages !== undefined) {
      outPatch.sitemapAutoExcludeDepthPages = depthFieldFromUnknown(
        patch,
        "sitemapAutoExcludeDepthPages",
      );
    }
    if (patch.sitemapAutoExcludeDepthBlog !== undefined) {
      outPatch.sitemapAutoExcludeDepthBlog = depthFieldFromUnknown(
        patch,
        "sitemapAutoExcludeDepthBlog",
      );
    }
    if (patch.sitemapAutoExcludeDepthPublications !== undefined) {
      outPatch.sitemapAutoExcludeDepthPublications = depthFieldFromUnknown(
        patch,
        "sitemapAutoExcludeDepthPublications",
      );
    }
    if (patch.sitemapAutoExcludeDepthTeaching !== undefined) {
      outPatch.sitemapAutoExcludeDepthTeaching = depthFieldFromUnknown(
        patch,
        "sitemapAutoExcludeDepthTeaching",
      );
    }
    if (patch.rootPageId !== undefined) {
      outPatch.rootPageId = getString(patch, "rootPageId", { maxLen: 64 });
    }
    if (patch.homePageId !== undefined) {
      outPatch.homePageId = getString(patch, "homePageId", { maxLen: 64 });
    }

    return { ok: true, value: { kind, rowId, patch: outPatch } };
  }

  if (kind === "nav-update") {
    const rowId = compactId(getString(body, "rowId"));
    if (!rowId) return bad("Missing rowId", 400);

    const patch = isObject(body.patch) ? body.patch : {};
    const outPatch: SiteAdminNavPatch = {};

    if (patch.label !== undefined) {
      outPatch.label = getString(patch, "label", { maxLen: 120 });
    }
    if (patch.href !== undefined) {
      outPatch.href = getString(patch, "href", { maxLen: 300 });
    }
    if (patch.group !== undefined) {
      outPatch.group = getEnum(patch, "group", ["top", "more"] as const, "more");
    }
    if (patch.order !== undefined) {
      outPatch.order = getNumber(patch, "order") ?? 0;
    }
    if (patch.enabled !== undefined) {
      const enabled = getBoolean(patch, "enabled");
      if (enabled !== null) outPatch.enabled = enabled;
    }

    return { ok: true, value: { kind, rowId, patch: outPatch } };
  }

  const input = isObject(body.input) ? body.input : {};
  return {
    ok: true,
    value: {
      kind,
      input: {
        label: getString(input, "label", { maxLen: 120 }),
        href: getString(input, "href", { maxLen: 300 }),
        group: getEnum(input, "group", ["top", "more"] as const, "more"),
        order: getNumber(input, "order") ?? 0,
        enabled: getBoolean(input, "enabled") ?? true,
      },
    },
  };
}

export { parseSiteAdminRoutesCommand };
export type { SiteAdminRoutesCommand };
