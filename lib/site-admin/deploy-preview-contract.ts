import type {
  SiteAdminDeployPreviewPayload,
  SiteAdminDeployPreviewResult,
} from "./api-types";

type ApiAck = { ok: true } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readApiErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "";
  const error = value.error;
  return typeof error === "string" && error.trim() ? error : "";
}

function asApiAck(value: unknown, fallbackError = "Request failed"): ApiAck | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok) return { ok: true };
  return { ok: false, error: readApiErrorMessage(value) || fallbackError };
}

function parseRedirectChange(value: unknown): SiteAdminDeployPreviewPayload["samples"]["redirects"][number] | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  const source = value.source;
  const pageId = value.pageId;
  const title = value.title;
  const fromPath = value.fromPath;
  const toPath = value.toPath;
  if (kind !== "added" && kind !== "removed" && kind !== "changed") return null;
  if (source !== "route" && source !== "override" && source !== "both") return null;
  if (typeof pageId !== "string") return null;
  if (typeof title !== "string") return null;
  if (typeof fromPath !== "string") return null;
  if (typeof toPath !== "string") return null;
  return { kind, source, pageId, title, fromPath, toPath };
}

function parseProtectedChange(value: unknown): SiteAdminDeployPreviewPayload["samples"]["protected"][number] | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  const pageId = value.pageId;
  const path = value.path;
  const mode = value.mode;
  const auth = value.auth;
  const previousMode = value.previousMode;
  const previousAuth = value.previousAuth;
  if (kind !== "added" && kind !== "removed" && kind !== "changed") return null;
  if (typeof pageId !== "string" || typeof path !== "string") return null;
  if (mode !== "exact" && mode !== "prefix") return null;
  if (auth !== "password" && auth !== "github") return null;
  if (previousMode !== undefined && previousMode !== "exact" && previousMode !== "prefix") return null;
  if (previousAuth !== undefined && previousAuth !== "password" && previousAuth !== "github") return null;
  return {
    kind,
    pageId,
    path,
    mode,
    auth,
    ...(previousMode === undefined ? {} : { previousMode }),
    ...(previousAuth === undefined ? {} : { previousAuth }),
  };
}

export function isSiteAdminDeployPreviewOk(
  value: SiteAdminDeployPreviewResult,
): value is SiteAdminDeployPreviewPayload {
  return value.ok;
}

export function parseSiteAdminDeployPreviewResult(x: unknown): SiteAdminDeployPreviewResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) return { ok: false, error: ack.error || "Request failed" };
  if (!isRecord(x)) return null;

  if (typeof x.generatedAt !== "string" || typeof x.hasChanges !== "boolean") return null;
  if (!isRecord(x.summary) || !isRecord(x.samples)) return null;

  const summary = x.summary;
  const samples = x.samples;
  const pagesAdded = summary.pagesAdded;
  const pagesRemoved = summary.pagesRemoved;
  const redirectsAdded = summary.redirectsAdded;
  const redirectsRemoved = summary.redirectsRemoved;
  const redirectsChanged = summary.redirectsChanged;
  const protectedAdded = summary.protectedAdded;
  const protectedRemoved = summary.protectedRemoved;
  const protectedChanged = summary.protectedChanged;
  if (typeof pagesAdded !== "number") return null;
  if (typeof pagesRemoved !== "number") return null;
  if (typeof redirectsAdded !== "number") return null;
  if (typeof redirectsRemoved !== "number") return null;
  if (typeof redirectsChanged !== "number") return null;
  if (typeof protectedAdded !== "number") return null;
  if (typeof protectedRemoved !== "number") return null;
  if (typeof protectedChanged !== "number") return null;

  if (!Array.isArray(samples.pagesAdded) || !samples.pagesAdded.every((v) => typeof v === "string")) return null;
  if (!Array.isArray(samples.pagesRemoved) || !samples.pagesRemoved.every((v) => typeof v === "string")) return null;
  if (!Array.isArray(samples.redirects) || !Array.isArray(samples.protected)) return null;

  const redirects = samples.redirects
    .map(parseRedirectChange)
    .filter((it): it is NonNullable<typeof it> => Boolean(it));
  const protectedChanges = samples.protected
    .map(parseProtectedChange)
    .filter((it): it is NonNullable<typeof it> => Boolean(it));
  if (redirects.length !== samples.redirects.length) return null;
  if (protectedChanges.length !== samples.protected.length) return null;

  return {
    ok: true,
    generatedAt: x.generatedAt,
    hasChanges: x.hasChanges,
    summary: {
      pagesAdded,
      pagesRemoved,
      redirectsAdded,
      redirectsRemoved,
      redirectsChanged,
      protectedAdded,
      protectedRemoved,
      protectedChanged,
    },
    samples: {
      pagesAdded: samples.pagesAdded,
      pagesRemoved: samples.pagesRemoved,
      redirects,
      protected: protectedChanges,
    },
  };
}
