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
};

type StatusResult = StatusPayload | { ok: false; error: string };

function fmtWhen(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return "—";
  }
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
      if (!r.ok || !data) throw new Error((data as any)?.error || `HTTP ${r.status}`);
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

  return (
    <section className="site-admin-status">
      <div className="site-admin-status__head">
        <div>
          <h2 className="notion-heading notion-semantic-string" style={{ margin: 0 }}>
            Status
          </h2>
          <p className="notion-text notion-text__content notion-semantic-string" style={{ marginTop: 6 }}>
            Quick sanity-check that Notion sync ran and this deploy is using the expected config.
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
            <div className="site-admin-card__title">Notion + Sync</div>
            <dl className="site-admin-kv">
              <div className="site-admin-kv__row">
                <dt>NOTION_TOKEN</dt>
                <dd>
                  <Badge ok={payload.env.hasNotionToken}>
                    {payload.env.hasNotionToken ? "configured" : "missing"}
                  </Badge>
                </dd>
              </div>
              <div className="site-admin-kv__row">
                <dt>Admin Page ID</dt>
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
                    <code className="code">{payload.content.syncMeta.syncedAt}</code>
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
                <dt>Notion sync cache</dt>
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
