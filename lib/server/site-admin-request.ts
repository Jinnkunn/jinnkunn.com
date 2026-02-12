import "server-only";

import { compactId } from "@/lib/shared/route-utils";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";
import {
  getBoolean,
  getEnum,
  getNumber,
  getString,
  isObject,
} from "@/lib/server/validate";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

export type SiteAdminSettingsPatch = Partial<Omit<SiteSettings, "rowId">>;
export type SiteAdminNavPatch = Partial<Omit<NavItemRow, "rowId">>;
export type SiteAdminNavCreateInput = Omit<NavItemRow, "rowId">;

export type SiteAdminConfigCommand =
  | { kind: "settings"; rowId: string; patch: SiteAdminSettingsPatch }
  | { kind: "nav-update"; rowId: string; patch: SiteAdminNavPatch }
  | { kind: "nav-create"; input: SiteAdminNavCreateInput };

export type SiteAdminRoutesCommand =
  | { kind: "override"; pageId: string; routePath: string }
  | {
      kind: "protected";
      pageId: string;
      path: string;
      authKind: "public" | "password" | "github";
      password: string;
    };

function bad(error: string, status = 400): ParseResult<never> {
  return { ok: false, error, status };
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
    if (patch.googleAnalyticsId !== undefined) {
      outPatch.googleAnalyticsId = getString(patch, "googleAnalyticsId", { maxLen: 64 });
    }
    if (patch.contentGithubUsers !== undefined) {
      outPatch.contentGithubUsers = getString(patch, "contentGithubUsers", { maxLen: 800 });
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

export function parseSiteAdminRoutesCommand(
  body: Record<string, unknown>,
): ParseResult<SiteAdminRoutesCommand> {
  const kind = getEnum(body, "kind", ["override", "protected"] as const, "");
  if (!kind) return bad("Unsupported kind", 400);

  if (kind === "override") {
    const pageId = compactId(getString(body, "pageId"));
    if (!pageId) return bad("Missing pageId", 400);
    const routePath = getString(body, "routePath", { maxLen: 300 });
    return { ok: true, value: { kind, pageId, routePath } };
  }

  const pageId = compactId(getString(body, "pageId"));
  if (!pageId) return bad("Missing pageId", 400);

  const path = getString(body, "path", { maxLen: 300 });
  if (!path) return bad("Missing path", 400);

  const authKind = getEnum(
    body,
    "auth",
    ["public", "password", "github"] as const,
    "password",
  );
  const password = getString(body, "password", { maxLen: 160 });
  if (authKind === "github" && password) {
    return bad("GitHub auth does not use a password", 400);
  }

  return { ok: true, value: { kind, pageId, path, authKind, password } };
}
