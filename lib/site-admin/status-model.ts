import type { SiteAdminStat, SiteAdminStatusPayload } from "./api-types.ts";

export type StatusFreshness = {
  ok: boolean;
  reason: string;
  synced: number;
  adminEdited: number;
  rootEdited: number;
};

export type GeneratedState = {
  ok: boolean;
  mtimeMs: number;
  reason: string;
};

export type ReadinessState = {
  ok: boolean;
  reason: string;
  okHint?: string;
};

export type BannerState = {
  kind: "ok" | "warn";
  title: string;
  detail: string;
};

export type SiteAdminStatusDerived = {
  vercelLink: string;
  stale: StatusFreshness;
  generated: GeneratedState;
  readiness: ReadinessState;
  banner: BannerState | null;
};

function parseIsoMs(iso?: string | null): number {
  const s = String(iso || "").trim();
  if (!s) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function formatDelta(ms: number): string {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const sec = Math.floor(abs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day > 0) return `${sign}${day}d ${hr % 24}h`;
  if (hr > 0) return `${sign}${hr}h ${min % 60}m`;
  if (min > 0) return `${sign}${min}m`;
  return `${sign}${sec}s`;
}

function maxFinite(values: Array<number | undefined>): number {
  const nums = values.filter((n): n is number => Number.isFinite(n));
  return nums.length ? Math.max(...nums) : NaN;
}

function requiredGeneratedFiles(payload: SiteAdminStatusPayload): Array<[string, SiteAdminStat]> {
  const files = payload.files;
  return [
    ["site-config.json", files.siteConfig],
    ["routes-manifest.json", files.routesManifest],
    ["protected-routes.json", files.protectedRoutes],
    ["sync-meta.json", files.syncMeta],
    ["search-index.json", files.searchIndex],
    ["routes.json", files.routesJson],
  ];
}

export function deriveStatusFreshness(payload: SiteAdminStatusPayload | null): StatusFreshness {
  const f = payload?.freshness;
  if (f && typeof f.stale === "boolean") {
    const ok = !f.stale;
    const syncMs = typeof f.syncMs === "number" ? f.syncMs : NaN;
    const editedMs = typeof f.notionEditedMs === "number" ? f.notionEditedMs : NaN;
    const reason =
      !ok && Number.isFinite(syncMs) && Number.isFinite(editedMs)
        ? `Edited +${formatDelta(editedMs - syncMs)}`
        : "";
    return { ok, reason, synced: syncMs, adminEdited: NaN, rootEdited: NaN };
  }

  if (!payload?.content?.syncMeta?.syncedAt) {
    return { ok: true, reason: "", synced: NaN, adminEdited: NaN, rootEdited: NaN };
  }
  const synced = parseIsoMs(payload.content.syncMeta.syncedAt);
  if (!Number.isFinite(synced)) {
    return { ok: true, reason: "", synced, adminEdited: NaN, rootEdited: NaN };
  }

  const adminEdited = parseIsoMs(payload.notion.adminPage?.lastEdited);
  const rootEdited = parseIsoMs(payload.notion.rootPage?.lastEdited);

  const toleranceMs = 30_000;
  const adminStale = Number.isFinite(adminEdited) && adminEdited > synced + toleranceMs;
  const rootStale = Number.isFinite(rootEdited) && rootEdited > synced + toleranceMs;
  const ok = !(adminStale || rootStale);

  const parts: string[] = [];
  if (adminStale) parts.push(`Admin edited +${formatDelta(adminEdited - synced)}`);
  if (rootStale) parts.push(`Root edited +${formatDelta(rootEdited - synced)}`);
  return { ok, reason: parts.join("; "), synced, adminEdited, rootEdited };
}

export function deriveGeneratedState(payload: SiteAdminStatusPayload | null): GeneratedState {
  if (!payload) return { ok: true, mtimeMs: NaN, reason: "" };

  const syncedIso = payload?.content?.syncMeta?.syncedAt || "";
  const synced = parseIsoMs(syncedIso);
  const files = payload.files;

  const required = requiredGeneratedFiles(payload);
  const missing = required.filter(([, st]) => !st.exists).map(([name]) => name);
  if (missing.length) {
    return { ok: false, mtimeMs: NaN, reason: `Missing: ${missing.join(", ")}` };
  }

  const maxMtime = maxFinite([
    files.siteConfig?.mtimeMs,
    files.routesManifest?.mtimeMs,
    files.protectedRoutes?.mtimeMs,
    files.syncMeta?.mtimeMs,
    files.searchIndex?.mtimeMs,
    files.routesJson?.mtimeMs,
  ]);

  if (!Number.isFinite(maxMtime)) return { ok: true, mtimeMs: NaN, reason: "" };
  if (!Number.isFinite(synced)) return { ok: true, mtimeMs: maxMtime, reason: "" };

  const toleranceMs = 2 * 60_000;
  const older = maxMtime < synced - toleranceMs;
  const newer = maxMtime > synced + toleranceMs;
  const ok = !(older || newer);
  const reason = older
    ? `Generated is older than Sync Meta by ${formatDelta(synced - maxMtime)}`
    : newer
      ? `Generated is newer than Sync Meta by ${formatDelta(maxMtime - synced)}`
      : "";
  return { ok, mtimeMs: maxMtime, reason };
}

export function deriveReadinessState(payload: SiteAdminStatusPayload | null): ReadinessState {
  const env = payload?.env;
  if (!env) return { ok: true, reason: "" };

  const parts: string[] = [];
  const okParts: string[] = [];

  if (!env.hasNextAuthSecret) parts.push("Missing NEXTAUTH_SECRET");
  else okParts.push("Auth secret");

  if (env.githubAllowlistCount <= 0) parts.push("Empty GitHub allowlist");
  else okParts.push("GitHub allowlist");

  if (!env.hasDeployHookUrl) parts.push("Missing deploy hook");
  else okParts.push("Deploy hook");

  if (!env.hasFlagsSecret) parts.push("Missing FLAGS_SECRET");
  else okParts.push("Flags secret");

  return { ok: parts.length === 0, reason: parts.join("; "), okHint: okParts.join(", ") };
}

export function deriveStatusBanner(
  payload: SiteAdminStatusPayload | null,
  stale: StatusFreshness,
  generated: GeneratedState,
  readiness: ReadinessState,
): BannerState | null {
  if (!payload) return null;

  const parts: string[] = [];
  if (!stale.ok) parts.push(stale.reason ? `Freshness: ${stale.reason}` : "Freshness: stale");
  if (!generated.ok) parts.push(generated.reason ? `Generated: ${generated.reason}` : "Generated: mismatch");
  if (!readiness.ok) parts.push(readiness.reason ? `Admin: ${readiness.reason}` : "Admin: needs setup");
  if (payload?.preflight) {
    const pre = payload.preflight;
    const preParts: string[] = [];
    if (!pre.generatedFiles.ok) preParts.push(`missing routes ${pre.generatedFiles.missingRoutes.length}`);
    if (!pre.routeOverrides.ok) preParts.push("route overrides");
    if (!pre.navigation.ok) preParts.push("nav links");
    if (!pre.notionBlocks.ok) preParts.push(`unsupported blocks ${pre.notionBlocks.unsupportedBlockCount}`);
    if (preParts.length > 0) parts.push(`Preflight: ${preParts.join(", ")}`);
  }

  if (!parts.length) {
    return {
      kind: "ok",
      title: "Up-to-date",
      detail: "This deployment looks consistent with the latest content + config.",
    };
  }
  return {
    kind: "warn",
    title: "Attention Needed",
    detail: parts.join(" · "),
  };
}

export function deriveVercelLink(payload: SiteAdminStatusPayload | null): string {
  const url = payload?.build?.vercelUrl?.trim() || "";
  if (!url) return "";
  return url.startsWith("http") ? url : `https://${url}`;
}

export function deriveSiteAdminStatus(payload: SiteAdminStatusPayload | null): SiteAdminStatusDerived {
  const stale = deriveStatusFreshness(payload);
  const generated = deriveGeneratedState(payload);
  const readiness = deriveReadinessState(payload);
  const banner = deriveStatusBanner(payload, stale, generated, readiness);
  const vercelLink = deriveVercelLink(payload);
  return { stale, generated, readiness, banner, vercelLink };
}
