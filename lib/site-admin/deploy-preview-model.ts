import type {
  SiteAdminDeployPreviewPayload,
  SiteAdminDeployPreviewProtectedChange,
  SiteAdminDeployPreviewRedirectChange,
} from "./api-types.ts";
import {
  normalizeProtectedAccessMode,
  type ProtectedAccessMode,
} from "../shared/access.ts";
import { compactId, normalizeRoutePath } from "../shared/route-utils.ts";

export type DeployPreviewRouteEntry = {
  pageId: string;
  routePath: string;
  title: string;
};

export type DeployPreviewProtectedEntry = {
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  auth: ProtectedAccessMode;
};

export type BuildDeployPreviewDiffInput = {
  currentRoutes: DeployPreviewRouteEntry[];
  liveRoutes: DeployPreviewRouteEntry[];
  currentOverrides: Record<string, string>;
  liveOverrides: Record<string, string>;
  currentProtected: DeployPreviewProtectedEntry[];
  liveProtected: DeployPreviewProtectedEntry[];
};

type DeployPreviewDiff = Omit<SiteAdminDeployPreviewPayload, "ok" | "generatedAt">;

function normalizeEntryRoute(value: string): string {
  return normalizeRoutePath(value) || "";
}

function normalizeRouteEntries(items: DeployPreviewRouteEntry[]): DeployPreviewRouteEntry[] {
  const out: DeployPreviewRouteEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const pageId = compactId(item.pageId);
    const routePath = normalizeEntryRoute(item.routePath);
    const title = String(item.title || "").trim() || "Untitled";
    if (!pageId || !routePath) continue;
    if (seen.has(pageId)) continue;
    seen.add(pageId);
    out.push({ pageId, routePath, title });
  }
  out.sort((a, b) => a.pageId.localeCompare(b.pageId));
  return out;
}

function normalizeOverrideRecord(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawPageId, rawPath] of Object.entries(input || {})) {
    const pageId = compactId(rawPageId);
    const routePath = normalizeEntryRoute(rawPath);
    if (!pageId || !routePath) continue;
    out[pageId] = routePath;
  }
  return out;
}

function normalizeProtectedEntries(items: DeployPreviewProtectedEntry[]): DeployPreviewProtectedEntry[] {
  const out: DeployPreviewProtectedEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const pageId = compactId(item.pageId);
    const path = normalizeEntryRoute(item.path);
    const mode = item.mode === "prefix" ? "prefix" : "exact";
    const auth = normalizeProtectedAccessMode(item.auth, "password");
    if (!pageId || !path) continue;
    const key = `${pageId}|${path}|${mode}|${auth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pageId, path, mode, auth });
  }
  out.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return a.pageId.localeCompare(b.pageId);
  });
  return out;
}

function mapRoutesByPageId(entries: DeployPreviewRouteEntry[]): Map<string, DeployPreviewRouteEntry> {
  const out = new Map<string, DeployPreviewRouteEntry>();
  for (const item of entries) out.set(item.pageId, item);
  return out;
}

function mapProtectedByBaseKey(
  entries: DeployPreviewProtectedEntry[],
): Map<string, DeployPreviewProtectedEntry> {
  const out = new Map<string, DeployPreviewProtectedEntry>();
  for (const item of entries) {
    const key = `${item.pageId}|${item.path}`;
    if (!out.has(key)) out.set(key, item);
  }
  return out;
}

function sortRedirectChanges(items: SiteAdminDeployPreviewRedirectChange[]): SiteAdminDeployPreviewRedirectChange[] {
  return [...items].sort((a, b) => {
    const byKind = a.kind.localeCompare(b.kind);
    if (byKind !== 0) return byKind;
    const byPage = a.pageId.localeCompare(b.pageId);
    if (byPage !== 0) return byPage;
    const byFrom = a.fromPath.localeCompare(b.fromPath);
    if (byFrom !== 0) return byFrom;
    return a.toPath.localeCompare(b.toPath);
  });
}

function sortProtectedChanges(items: SiteAdminDeployPreviewProtectedChange[]): SiteAdminDeployPreviewProtectedChange[] {
  return [...items].sort((a, b) => {
    const byKind = a.kind.localeCompare(b.kind);
    if (byKind !== 0) return byKind;
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return a.pageId.localeCompare(b.pageId);
  });
}

function mergeRedirectSource(
  prev: SiteAdminDeployPreviewRedirectChange["source"],
  next: SiteAdminDeployPreviewRedirectChange["source"],
): SiteAdminDeployPreviewRedirectChange["source"] {
  if (prev === next) return prev;
  return "both";
}

export function buildDeployPreviewDiff(input: BuildDeployPreviewDiffInput): DeployPreviewDiff {
  const currentRoutes = normalizeRouteEntries(input.currentRoutes);
  const liveRoutes = normalizeRouteEntries(input.liveRoutes);
  const currentOverrides = normalizeOverrideRecord(input.currentOverrides);
  const liveOverrides = normalizeOverrideRecord(input.liveOverrides);
  const currentProtected = normalizeProtectedEntries(input.currentProtected);
  const liveProtected = normalizeProtectedEntries(input.liveProtected);

  const currentById = mapRoutesByPageId(currentRoutes);
  const liveById = mapRoutesByPageId(liveRoutes);

  const allPageIds = new Set<string>([
    ...Array.from(currentById.keys()),
    ...Array.from(liveById.keys()),
  ]);

  const pagesAdded: string[] = [];
  const pagesRemoved: string[] = [];
  for (const pageId of allPageIds) {
    const current = currentById.get(pageId);
    const live = liveById.get(pageId);
    if (!current && live) {
      pagesAdded.push(live.routePath);
      continue;
    }
    if (current && !live) {
      pagesRemoved.push(current.routePath);
    }
  }
  pagesAdded.sort((a, b) => a.localeCompare(b));
  pagesRemoved.sort((a, b) => a.localeCompare(b));

  const redirectMap = new Map<string, SiteAdminDeployPreviewRedirectChange>();
  const upsertRedirect = (next: SiteAdminDeployPreviewRedirectChange) => {
    const key = `${next.kind}|${next.pageId}|${next.fromPath}|${next.toPath}`;
    const prev = redirectMap.get(key);
    if (!prev) {
      redirectMap.set(key, next);
      return;
    }
    redirectMap.set(key, { ...prev, source: mergeRedirectSource(prev.source, next.source) });
  };

  for (const pageId of allPageIds) {
    const current = currentById.get(pageId);
    const live = liveById.get(pageId);
    if (!current || !live) continue;
    if (current.routePath === live.routePath) continue;
    upsertRedirect({
      kind: "changed",
      source: "route",
      pageId,
      title: live.title || current.title,
      fromPath: current.routePath,
      toPath: live.routePath,
    });
  }

  const allOverridePageIds = new Set<string>([
    ...Object.keys(currentOverrides),
    ...Object.keys(liveOverrides),
  ]);

  for (const pageId of allOverridePageIds) {
    const before = normalizeEntryRoute(currentOverrides[pageId] || "");
    const after = normalizeEntryRoute(liveOverrides[pageId] || "");
    if (before === after) continue;
    const current = currentById.get(pageId);
    const live = liveById.get(pageId);
    const title = live?.title || current?.title || "Untitled";

    if (!before && after) {
      upsertRedirect({
        kind: "added",
        source: "override",
        pageId,
        title,
        fromPath: current?.routePath || "(default)",
        toPath: after,
      });
      continue;
    }
    if (before && !after) {
      upsertRedirect({
        kind: "removed",
        source: "override",
        pageId,
        title,
        fromPath: before,
        toPath: live?.routePath || "(default)",
      });
      continue;
    }
    upsertRedirect({
      kind: "changed",
      source: "override",
      pageId,
      title,
      fromPath: before,
      toPath: after,
    });
  }

  const redirects = sortRedirectChanges(Array.from(redirectMap.values()));
  const redirectsAdded = redirects.filter((it) => it.kind === "added").length;
  const redirectsRemoved = redirects.filter((it) => it.kind === "removed").length;
  const redirectsChanged = redirects.filter((it) => it.kind === "changed").length;

  const currentProtectedByBase = mapProtectedByBaseKey(currentProtected);
  const liveProtectedByBase = mapProtectedByBaseKey(liveProtected);
  const allProtectedKeys = new Set<string>([
    ...Array.from(currentProtectedByBase.keys()),
    ...Array.from(liveProtectedByBase.keys()),
  ]);

  const protectedChanges: SiteAdminDeployPreviewProtectedChange[] = [];
  for (const key of allProtectedKeys) {
    const before = currentProtectedByBase.get(key);
    const after = liveProtectedByBase.get(key);

    if (!before && after) {
      protectedChanges.push({
        kind: "added",
        pageId: after.pageId,
        path: after.path,
        mode: after.mode,
        auth: after.auth,
      });
      continue;
    }
    if (before && !after) {
      protectedChanges.push({
        kind: "removed",
        pageId: before.pageId,
        path: before.path,
        mode: before.mode,
        auth: before.auth,
      });
      continue;
    }
    if (!before || !after) continue;
    if (before.mode === after.mode && before.auth === after.auth) continue;
    protectedChanges.push({
      kind: "changed",
      pageId: after.pageId,
      path: after.path,
      mode: after.mode,
      auth: after.auth,
      previousMode: before.mode,
      previousAuth: before.auth,
    });
  }

  const protectedSorted = sortProtectedChanges(protectedChanges);
  const protectedAdded = protectedSorted.filter((it) => it.kind === "added").length;
  const protectedRemoved = protectedSorted.filter((it) => it.kind === "removed").length;
  const protectedChanged = protectedSorted.filter((it) => it.kind === "changed").length;

  const hasChanges =
    pagesAdded.length > 0 ||
    pagesRemoved.length > 0 ||
    redirects.length > 0 ||
    protectedSorted.length > 0;

  return {
    hasChanges,
    summary: {
      pagesAdded: pagesAdded.length,
      pagesRemoved: pagesRemoved.length,
      redirectsAdded,
      redirectsRemoved,
      redirectsChanged,
      protectedAdded,
      protectedRemoved,
      protectedChanged,
    },
    samples: {
      pagesAdded: pagesAdded.slice(0, 12),
      pagesRemoved: pagesRemoved.slice(0, 12),
      redirects: redirects.slice(0, 16),
      protected: protectedSorted.slice(0, 16),
    },
  };
}
