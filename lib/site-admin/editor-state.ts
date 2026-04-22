import type { AccessMode } from "@/lib/shared/access";
import { normalizeRoutePath } from "@/lib/shared/route-utils";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";

export type SiteAdminEditorResultKind =
  | "idle"
  | "saving"
  | "saved"
  | "conflict"
  | "error";

export type SiteAdminEditorStatusKind = SiteAdminEditorResultKind | "dirty";

export type SiteAdminEditorResultState = {
  kind: SiteAdminEditorResultKind;
  message: string;
};

export type SiteAdminEditorStatus = {
  kind: SiteAdminEditorStatusKind;
  message: string;
};

export const IDLE_EDITOR_RESULT: SiteAdminEditorResultState = {
  kind: "idle",
  message: "No local changes.",
};

const SITE_SETTINGS_KEYS: Array<keyof SiteSettings> = [
  "rowId",
  "siteName",
  "lang",
  "seoTitle",
  "seoDescription",
  "favicon",
  "ogImage",
  "seoPageOverrides",
  "googleAnalyticsId",
  "contentGithubUsers",
  "sitemapExcludes",
  "sitemapAutoExcludeEnabled",
  "sitemapAutoExcludeSections",
  "sitemapAutoExcludeDepthPages",
  "sitemapAutoExcludeDepthBlog",
  "sitemapAutoExcludeDepthPublications",
  "sitemapAutoExcludeDepthTeaching",
  "rootPageId",
  "homePageId",
];

export function deriveEditorStatus(input: {
  hasUnsavedChanges: boolean;
  result: SiteAdminEditorResultState;
  dirtyMessage: string;
  idleMessage?: string;
}): SiteAdminEditorStatus {
  const { hasUnsavedChanges, result, dirtyMessage, idleMessage } = input;
  if (result.kind === "saving") return { kind: "saving", message: result.message };
  if (result.kind === "conflict") return { kind: "conflict", message: result.message };
  if (result.kind === "error") return { kind: "error", message: result.message };
  if (hasUnsavedChanges) return { kind: "dirty", message: dirtyMessage };
  if (result.kind === "saved") return { kind: "saved", message: result.message };
  return { kind: "idle", message: idleMessage || result.message || "No local changes." };
}

export function mapEditorErrorToResult(input: {
  code?: string;
  message: string;
  conflictMessage: string;
}): SiteAdminEditorResultState {
  return input.code === "SOURCE_CONFLICT"
    ? { kind: "conflict", message: input.conflictMessage }
    : { kind: "error", message: input.message };
}

export function hasSiteSettingsChanges(
  baseline: SiteSettings | null,
  draft: SiteSettings | null,
): boolean {
  if (!baseline || !draft) return false;
  return SITE_SETTINGS_KEYS.some((key) => baseline[key] !== draft[key]);
}

export function hasNavRowDraftChanges(
  row: NavItemRow,
  draft: Partial<NavItemRow> | undefined,
): boolean {
  if (!draft) return false;
  return (
    (draft.label !== undefined && draft.label !== row.label) ||
    (draft.href !== undefined && draft.href !== row.href) ||
    (draft.group !== undefined && draft.group !== row.group) ||
    (draft.order !== undefined && draft.order !== row.order) ||
    (draft.enabled !== undefined && draft.enabled !== row.enabled)
  );
}

export function countDirtyNavRows(
  rows: NavItemRow[],
  drafts: Record<string, Partial<NavItemRow>>,
): number {
  let count = 0;
  for (const row of rows) {
    if (hasNavRowDraftChanges(row, drafts[row.rowId])) count += 1;
  }
  return count;
}

function normalizeComparableRoutePath(value: string): string {
  return normalizeRoutePath(value) || "";
}

export function hasRouteOverrideDraftChanges(savedValue: string, draftValue: string): boolean {
  return normalizeComparableRoutePath(savedValue) !== normalizeComparableRoutePath(draftValue);
}

export function hasRouteAccessDraftChanges(input: {
  inheritedProtected: boolean;
  baselineAccess: AccessMode;
  selectedAccess: AccessMode;
  passwordDraft: string;
}): boolean {
  if (input.inheritedProtected) return false;
  if (input.selectedAccess !== input.baselineAccess) return true;
  return input.selectedAccess === "password" && String(input.passwordDraft || "").trim().length > 0;
}
