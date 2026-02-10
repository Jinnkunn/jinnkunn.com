"use client";

import { useEffect, useMemo, useState } from "react";

type Stat = { exists: boolean; mtimeMs?: number; size?: number };

type StatusPayload = {
  ok: true;
  env: {
    nodeEnv: string;
    isVercel: boolean;
    vercelRegion: string;
    hasNotionToken: boolean;
    hasNotionAdminPageId: boolean;
    notionVersion: string;
    hasDeployHookUrl: boolean;
    hasNextAuthSecret: boolean;
    githubAllowlistCount: number;
    contentGithubAllowlistCount: number;
  };
  build: {
    commitSha: string;
    commitShort: string;
    branch: string;
    commitMessage: string;
    deploymentId: string;
    vercelUrl: string;
  };
  content: {
    siteName: string;
    nav: { top: number; more: number };
    routesDiscovered: number;
    searchIndexItems: number | null;
    syncMeta: null | {
      syncedAt: string;
      notionVersion?: string;
      adminPageId?: string;
      rootPageId?: string;
      homePageId?: string;
      homeTitle?: string;
      pages?: number;
      routes?: number;
      routeOverrides?: number;
      protectedRules?: number;
    };
  };
  files: {
    siteConfig: Stat;
    routesManifest: Stat;
    protectedRoutes: Stat;
    syncMeta: Stat;
    searchIndex: Stat;
    routesJson: Stat;
    notionSyncCache: Stat & { count?: number };
  };
  notion: {
    adminPage: null | { id: string; lastEdited: string; title: string };
    rootPage: null | { id: string; lastEdited: string; title: string };
  };
  freshness?: {
    stale: boolean | null;
    syncMs: number | null;
    notionEditedMs: number | null;
    generatedLatestMs: number | null;
  };
};

type StatusResult = StatusPayload | { ok: false; error: string };

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function recordErrorMessage(x: unknown): string | null {
  if (!isRecord(x)) return null;
  const e = x["error"];
  return typeof e === "string" && e.trim() ? e : null;
}

function fmtWhen(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return "—";
  }
}

function fmtIso(iso?: string | null): string {
  const s = String(iso || "").trim();
  if (!s) return "—";
  return s.replace("T", " ").replace("Z", " UTC");
}

function isoMs(iso?: string | null): number {
  const s = String(iso || "").trim();
  if (!s) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function fmtDelta(ms: number): string {
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

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={ok ? "site-admin-badge site-admin-badge--ok" : "site-admin-badge site-admin-badge--bad"}>
      {children}
    </span>
  );
}

export default function SiteAdminStatusClient() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<StatusResult | null>(null);

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/site-admin/status", { cache: "no-store" });
      const data = (await r.json().catch(() => null)) as StatusResult | null;
      if (!r.ok || !data) {
        const err = recordErrorMessage(data) || `HTTP ${r.status}`;
        throw new Error(err);
      }
      setRes(data);
    } catch (e) {
      setRes({ ok: false, error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const payload = res && "ok" in res && res.ok ? (res as StatusPayload) : null;

  const vercelLink = useMemo(() => {
    const url = payload?.build?.vercelUrl?.trim() || "";
    if (!url) return "";
    return url.startsWith("http") ? url : `https://${url}`;
  }, [payload?.build?.vercelUrl]);

  const stale = useMemo(() => {
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

    if (!payload?.content?.syncMeta?.syncedAt) return { ok: true, reason: "" };
    const synced = isoMs(payload.content.syncMeta.syncedAt);
    if (!Number.isFinite(synced)) return { ok: true, reason: "" };

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

  const generated = useMemo(() => {
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

  const readiness = useMemo(() => {
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

  return (
    <section className="site-admin-status">
      <div className="site-admin-status__head">
        <div>
          <h2 className="notion-heading notion-semantic-string" style={{ margin: 0 }}>
            Status
          </h2>
          <p className="notion-text notion-text__content notion-semantic-string" style={{ marginTop: 6 }}>
            Quick sanity-check that content sync ran and this deploy is using the expected config.
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="site-admin-status__refresh"
        >
          {busy ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {res && "ok" in res && !res.ok ? (
        <div className="site-admin-status__error">{res.error}</div>
      ) : null}

      {payload ? (
        <div className="site-admin-status__grid">
          <div className="site-admin-card">
            <div className="site-admin-card__title">Build</div>
            <dl className="site-admin-kv">
              <div className="site-admin-kv__row">
                <dt>Environment</dt>
                <dd>
                  <code className="code">{payload.env.nodeEnv || "unknown"}</code>{" "}
                  {payload.env.isVercel ? <Badge ok>Vercel</Badge> : <Badge ok={false}>Local</Badge>}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Commit</dt>
                <dd>
                  {payload.build.commitShort ? (
                    <code className="code">{payload.build.commitShort}</code>
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Branch</dt>
                <dd>{payload.build.branch || "—"}</dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Deployment</dt>
                <dd>
                  {vercelLink ? (
                    <a className="notion-link link" href={vercelLink} target="_blank" rel="noreferrer">
                      {payload.build.vercelUrl}
                    </a>
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          <div className="site-admin-card">
            <div className="site-admin-card__title">Content + Sync</div>
            <dl className="site-admin-kv">
              <div className="site-admin-kv__row">
                <dt>Source Token</dt>
                <dd>
                  <Badge ok={payload.env.hasNotionToken}>
                    {payload.env.hasNotionToken ? "configured" : "missing"}
                  </Badge>
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Admin Page</dt>
                <dd>
                  <Badge ok={payload.env.hasNotionAdminPageId}>
                    {payload.env.hasNotionAdminPageId ? "configured" : "missing"}
                  </Badge>
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Sync Meta</dt>
                <dd>
                  {payload.content.syncMeta?.syncedAt ? (
                    <code className="code">{fmtIso(payload.content.syncMeta.syncedAt)}</code>
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Freshness</dt>
                <dd>
                  <Badge ok={stale.ok}>{stale.ok ? "up-to-date" : "stale"}</Badge>
                  {!stale.ok && stale.reason ? (
                    <span className="site-admin-status__hint"> {stale.reason}</span>
                  ) : null}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Generated</dt>
                <dd>
                  {Number.isFinite(generated.mtimeMs) ? (
                    <>
                      <code className="code">{fmtWhen(generated.mtimeMs)}</code>{" "}
                      <Badge ok={generated.ok}>{generated.ok ? "ok" : "mismatch"}</Badge>
                      {!generated.ok && generated.reason ? (
                        <span className="site-admin-status__hint"> {generated.reason}</span>
                      ) : null}
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Action</dt>
                <dd>
                  {(!stale.ok || !generated.ok) && payload.env.hasDeployHookUrl ? (
                    <span>Deploy recommended</span>
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Admin Edited</dt>
                <dd>
                  {payload.notion.adminPage?.lastEdited ? (
                    <code className="code">{fmtIso(payload.notion.adminPage.lastEdited)}</code>
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Root Edited</dt>
                <dd>
                  {payload.notion.rootPage?.lastEdited ? (
                    <code className="code">{fmtIso(payload.notion.rootPage.lastEdited)}</code>
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Pages</dt>
                <dd>{payload.content.syncMeta?.pages ?? "—"}</dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Routes</dt>
                <dd>{payload.content.routesDiscovered}</dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Search Index</dt>
                <dd>
                  {typeof payload.content.searchIndexItems === "number" ? (
                    <span>{payload.content.searchIndexItems} items</span>
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Overrides</dt>
                <dd>{payload.content.syncMeta?.routeOverrides ?? "—"}</dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Protected rules</dt>
                <dd>{payload.content.syncMeta?.protectedRules ?? "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="site-admin-card">
            <div className="site-admin-card__title">Admin Requirements</div>
            <dl className="site-admin-kv">
              <div className="site-admin-kv__row">
                <dt>Readiness</dt>
                <dd>
                  <Badge ok={readiness.ok}>{readiness.ok ? "ready" : "needs setup"}</Badge>
                  {!readiness.ok && readiness.reason ? (
                    <span className="site-admin-status__hint"> {readiness.reason}</span>
                  ) : null}
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>NEXTAUTH_SECRET</dt>
                <dd>
                  <Badge ok={payload.env.hasNextAuthSecret}>
                    {payload.env.hasNextAuthSecret ? "configured" : "missing"}
                  </Badge>
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>GitHub allowlist</dt>
                <dd>
                  <code className="code">{payload.env.githubAllowlistCount}</code>
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Content allowlist</dt>
                <dd>
                  <code className="code">{payload.env.contentGithubAllowlistCount}</code>
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Deploy Hook</dt>
                <dd>
                  <Badge ok={payload.env.hasDeployHookUrl}>
                    {payload.env.hasDeployHookUrl ? "configured" : "missing"}
                  </Badge>
                </dd>
              </div>
            </dl>
          </div>

          <div className="site-admin-card">
            <div className="site-admin-card__title">Generated Files</div>
            <dl className="site-admin-kv">
              {(
                [
                  ["site-config.json", payload.files.siteConfig],
                  ["routes-manifest.json", payload.files.routesManifest],
                  ["protected-routes.json", payload.files.protectedRoutes],
                  ["sync-meta.json", payload.files.syncMeta],
                  ["search-index.json", payload.files.searchIndex],
                  ["routes.json", payload.files.routesJson],
                ] as const
              ).map(([name, st]) => (
                <div className="site-admin-kv__row" key={name}>
                  <dt>{name}</dt>
                  <dd>
                    <Badge ok={st.exists}>{st.exists ? "present" : "missing"}</Badge>{" "}
                    <span className="site-admin-kv__muted">{fmtWhen(st.mtimeMs)}</span>
                  </dd>
                </div>
              ))}

              <div className="site-admin-kv__row">
                <dt>Sync cache</dt>
                <dd>
                  <Badge ok={payload.files.notionSyncCache.exists}>
                    {payload.files.notionSyncCache.exists ? "present" : "missing"}
                  </Badge>{" "}
                  <span className="site-admin-kv__muted">
                    {payload.files.notionSyncCache.exists
                      ? `${payload.files.notionSyncCache.count ?? 0} entries`
                      : "—"}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  );
}
