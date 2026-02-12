"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Stat, StatusPayload, StatusResult } from "@/components/site-admin/status/types";
import { asStatusResult, fmtDelta, isoMs } from "@/components/site-admin/status/utils";
import { requestJsonOrThrow } from "@/lib/client/request-json";

function isStatusOk(v: StatusResult): v is StatusPayload {
  return v.ok;
}

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

export function useSiteAdminStatusData() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<StatusResult | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await requestJsonOrThrow(
        "/api/site-admin/status",
        { cache: "no-store" },
        asStatusResult,
        { isOk: isStatusOk },
      );
      setRes(data);
    } catch (e) {
      setRes({ ok: false, error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const payload = res && "ok" in res && res.ok ? (res as StatusPayload) : null;

  const vercelLink = useMemo(() => {
    const url = payload?.build?.vercelUrl?.trim() || "";
    if (!url) return "";
    return url.startsWith("http") ? url : `https://${url}`;
  }, [payload?.build?.vercelUrl]);

  const stale = useMemo<StatusFreshness>(() => {
    const f = payload?.freshness;
    if (f && typeof f.stale === "boolean") {
      const ok = !f.stale;
      const syncMs = typeof f.syncMs === "number" ? f.syncMs : NaN;
      const editedMs = typeof f.notionEditedMs === "number" ? f.notionEditedMs : NaN;
      const reason =
        !ok && Number.isFinite(syncMs) && Number.isFinite(editedMs)
          ? `Edited +${fmtDelta(editedMs - syncMs)}`
          : "";
      return { ok, reason, synced: syncMs, adminEdited: NaN, rootEdited: NaN };
    }

    if (!payload?.content?.syncMeta?.syncedAt) return { ok: true, reason: "", synced: NaN, adminEdited: NaN, rootEdited: NaN };
    const synced = isoMs(payload.content.syncMeta.syncedAt);
    if (!Number.isFinite(synced)) return { ok: true, reason: "", synced, adminEdited: NaN, rootEdited: NaN };

    const adminEdited = isoMs(payload.notion.adminPage?.lastEdited);
    const rootEdited = isoMs(payload.notion.rootPage?.lastEdited);

    // If the source shows edits after the last sync, the deploy is likely stale.
    // Add a small tolerance to avoid flapping due to clock precision.
    const toleranceMs = 30_000;
    const adminStale = Number.isFinite(adminEdited) && adminEdited > synced + toleranceMs;
    const rootStale = Number.isFinite(rootEdited) && rootEdited > synced + toleranceMs;
    const ok = !(adminStale || rootStale);

    const parts: string[] = [];
    if (adminStale) parts.push(`Admin edited +${fmtDelta(adminEdited - synced)}`);
    if (rootStale) parts.push(`Root edited +${fmtDelta(rootEdited - synced)}`);
    return { ok, reason: parts.join("; "), synced, adminEdited, rootEdited };
  }, [payload]);

  const generated = useMemo<GeneratedState>(() => {
    const syncedIso = payload?.content?.syncMeta?.syncedAt || "";
    const synced = isoMs(syncedIso);
    const files = payload?.files;
    if (!files) return { ok: true, mtimeMs: NaN, reason: "" };

    const required: Array<[string, Stat]> = [
      ["site-config.json", files.siteConfig],
      ["routes-manifest.json", files.routesManifest],
      ["protected-routes.json", files.protectedRoutes],
      ["sync-meta.json", files.syncMeta],
      ["search-index.json", files.searchIndex],
      ["routes.json", files.routesJson],
    ];
    const missing = required.filter(([, st]) => !st.exists).map(([name]) => name);
    if (missing.length) {
      return { ok: false, mtimeMs: NaN, reason: `Missing: ${missing.join(", ")}` };
    }

    const mtimes = [
      files.siteConfig?.mtimeMs,
      files.routesManifest?.mtimeMs,
      files.protectedRoutes?.mtimeMs,
      files.syncMeta?.mtimeMs,
      files.searchIndex?.mtimeMs,
      files.routesJson?.mtimeMs,
    ].filter((n): n is number => typeof n === "number" && Number.isFinite(n));

    const maxMtime = mtimes.length ? Math.max(...mtimes) : NaN;
    if (!Number.isFinite(maxMtime)) return { ok: true, mtimeMs: NaN, reason: "" };

    // If sync meta exists, generated files should be written around the same time.
    const toleranceMs = 2 * 60_000;
    if (!Number.isFinite(synced)) return { ok: true, mtimeMs: maxMtime, reason: "" };

    const older = maxMtime < synced - toleranceMs;
    const newer = maxMtime > synced + toleranceMs;
    const ok = !(older || newer);

    const reason = older
      ? `Generated is older than Sync Meta by ${fmtDelta(synced - maxMtime)}`
      : newer
        ? `Generated is newer than Sync Meta by ${fmtDelta(maxMtime - synced)}`
        : "";
    return { ok, mtimeMs: maxMtime, reason };
  }, [payload]);

  const readiness = useMemo<ReadinessState>(() => {
    const parts: string[] = [];
    const okParts: string[] = [];
    const env = payload?.env;
    if (!env) return { ok: true, reason: "" };

    if (!env.hasNextAuthSecret) parts.push("Missing NEXTAUTH_SECRET");
    else okParts.push("Auth secret");

    if (env.githubAllowlistCount <= 0) parts.push("Empty GitHub allowlist");
    else okParts.push("GitHub allowlist");

    if (!env.hasDeployHookUrl) parts.push("Missing deploy hook");
    else okParts.push("Deploy hook");

    return { ok: parts.length === 0, reason: parts.join("; "), okHint: okParts.join(", ") };
  }, [payload]);

  const banner = useMemo<BannerState | null>(() => {
    if (!payload) return null;
    const parts: string[] = [];
    if (!stale.ok) parts.push(stale.reason ? `Freshness: ${stale.reason}` : "Freshness: stale");
    if (!generated.ok) parts.push(generated.reason ? `Generated: ${generated.reason}` : "Generated: mismatch");
    if (!readiness.ok) parts.push(readiness.reason ? `Admin: ${readiness.reason}` : "Admin: needs setup");
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
  }, [payload, stale.ok, stale.reason, generated.ok, generated.reason, readiness.ok, readiness.reason]);

  return {
    busy,
    res,
    payload,
    vercelLink,
    stale,
    generated,
    readiness,
    banner,
    load,
  };
}
