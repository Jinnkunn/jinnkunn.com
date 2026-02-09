"use client";

import { useEffect, useMemo, useState } from "react";

type SiteSettings = {
  rowId: string;
  siteName: string;
  lang: string;
  seoTitle: string;
  seoDescription: string;
  favicon: string;
  googleAnalyticsId: string;
  rootPageId: string;
  homePageId: string;
};

type NavItemRow = {
  rowId: string;
  label: string;
  href: string;
  group: "top" | "more";
  order: number;
  enabled: boolean;
};

type ApiGet = { ok: true; settings: SiteSettings | null; nav: NavItemRow[] } | { ok: false; error: string };

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function asString(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function asNumber(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export default function SiteAdminConfigClient() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [nav, setNav] = useState<NavItemRow[]>([]);

  const [draftSettings, setDraftSettings] = useState<SiteSettings | null>(null);
  const [navDraft, setNavDraft] = useState<Record<string, Partial<NavItemRow>>>({});

  useEffect(() => {
    let cancelled = false;
    const isOk = (x: any): x is { ok: true; settings: SiteSettings | null; nav: NavItemRow[] } =>
      Boolean(x) && x.ok === true;
    const run = async () => {
      setErr("");
      try {
        const res = await fetch("/api/site-admin/config", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as ApiGet | null;
        if (!res.ok || !isOk(data)) {
          throw new Error((data as any)?.error || `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setSettings(data.settings);
          setDraftSettings(data.settings ? { ...data.settings } : null);
          setNav(data.nav || []);
          setNavDraft({});
        }
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const navByGroup = useMemo(() => {
    const top = nav.filter((x) => x.group === "top");
    const more = nav.filter((x) => x.group === "more");
    return { top, more };
  }, [nav]);

  const saveSettings = async () => {
    if (!draftSettings?.rowId) return;
    setBusy(true);
    setErr("");
    try {
      const patch: Record<string, unknown> = {
        siteName: draftSettings.siteName,
        lang: draftSettings.lang,
        seoTitle: draftSettings.seoTitle,
        seoDescription: draftSettings.seoDescription,
        favicon: draftSettings.favicon,
        googleAnalyticsId: draftSettings.googleAnalyticsId,
        rootPageId: draftSettings.rootPageId,
        homePageId: draftSettings.homePageId,
      };
      const res = await fetch("/api/site-admin/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "settings", rowId: draftSettings.rowId, patch }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSettings({ ...draftSettings });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const updateNavDraftField = (rowId: string, patch: Partial<NavItemRow>) => {
    setNavDraft((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] || {}), ...patch } }));
  };

  const saveNavRow = async (row: NavItemRow) => {
    setBusy(true);
    setErr("");
    try {
      const patch = navDraft[row.rowId] || {};
      const res = await fetch("/api/site-admin/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "nav-update", rowId: row.rowId, patch }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setNav((prev) =>
        prev.map((it) => (it.rowId === row.rowId ? { ...it, ...(patch as any) } : it))
      );
      setNavDraft((prev) => {
        const next = { ...prev };
        delete next[row.rowId];
        return next;
      });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const addNavRow = async (group: "top" | "more") => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/site-admin/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "nav-create",
          input: {
            label: "New item",
            href: "/new",
            group,
            order: 999,
            enabled: true,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const created = data.created as NavItemRow | null;
      if (created?.rowId) setNav((prev) => [...prev, created].sort((a, b) => a.order - b.order));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const renderNavTable = (rows: NavItemRow[]) => (
    <div className="routes-explorer__table" role="table" aria-label="Navigation items">
      <div className="routes-explorer__row routes-explorer__row--head" role="row">
        <div className="routes-explorer__cell routes-explorer__cell--title" role="columnheader">
          Label
        </div>
        <div className="routes-explorer__cell routes-explorer__cell--route" role="columnheader">
          Href
        </div>
        <div className="routes-explorer__cell routes-explorer__cell--kind" role="columnheader">
          Meta
        </div>
      </div>

      {rows.map((it) => {
        const d = navDraft[it.rowId] || {};
        const dirty = Object.keys(d).length > 0;
        return (
          <div key={it.rowId} className="routes-explorer__row" role="row">
            <div className="routes-explorer__cell routes-explorer__cell--title" role="cell">
              <input
                className="routes-explorer__admin-input"
                value={asString(d.label ?? it.label)}
                onChange={(e) => updateNavDraftField(it.rowId, { label: e.target.value })}
              />
              <div className="routes-explorer__id">
                {it.rowId}{" "}
                <button
                  type="button"
                  className="routes-explorer__copy"
                  onClick={() => navigator.clipboard?.writeText(it.rowId)}
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="routes-explorer__cell routes-explorer__cell--route" role="cell">
              <input
                className="routes-explorer__admin-input"
                value={asString(d.href ?? it.href)}
                onChange={(e) => updateNavDraftField(it.rowId, { href: e.target.value })}
                placeholder="/blog"
              />
            </div>

            <div className="routes-explorer__cell routes-explorer__cell--kind" role="cell">
              <div className="routes-explorer__admin" style={{ marginTop: 0 }}>
                <div className="routes-explorer__admin-row" style={{ gridTemplateColumns: "88px 110px 1fr auto auto" }}>
                  <label className="routes-explorer__admin-label">Order</label>
                  <input
                    className="routes-explorer__admin-input"
                    inputMode="numeric"
                    value={String(asNumber(d.order ?? it.order))}
                    onChange={(e) => updateNavDraftField(it.rowId, { order: asNumber(e.target.value) })}
                  />
                  <label className="routes-explorer__admin-label" style={{ justifySelf: "start" }}>
                    Enabled
                  </label>
                  <input
                    type="checkbox"
                    checked={Boolean(d.enabled ?? it.enabled)}
                    onChange={(e) => updateNavDraftField(it.rowId, { enabled: e.target.checked })}
                    aria-label="Enabled"
                    style={{ height: 18, width: 18, alignSelf: "center" }}
                  />
                  <button
                    type="button"
                    className={cn("routes-explorer__admin-btn", dirty ? "" : "is-muted")}
                    disabled={busy || !dirty}
                    onClick={() => saveNavRow(it)}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <section>
        <h2 className="notion-heading notion-semantic-string">Config</h2>
        <p className="notion-text notion-text__content notion-semantic-string">
          Edits here write to Notion databases under your Site Admin page. Changes take effect after you click Deploy.
        </p>
      </section>

      {err ? <div className="routes-explorer__error">{err}</div> : null}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h3 className="notion-heading notion-semantic-string">Site Settings</h3>
        {draftSettings ? (
          <div className="routes-explorer__admin" style={{ marginTop: 0 }}>
            {(
              [
                { k: "siteName", label: "Site Name" },
                { k: "lang", label: "Lang" },
                { k: "seoTitle", label: "SEO Title" },
                { k: "seoDescription", label: "SEO Description" },
                { k: "favicon", label: "Favicon" },
                { k: "googleAnalyticsId", label: "GA ID" },
                { k: "rootPageId", label: "Root Page ID" },
                { k: "homePageId", label: "Home Page ID" },
              ] as const
            ).map((f) => (
              <div key={f.k} className="routes-explorer__admin-row">
                <label className="routes-explorer__admin-label">{f.label}</label>
                <input
                  className="routes-explorer__admin-input"
                  value={asString((draftSettings as any)[f.k])}
                  onChange={(e) => setDraftSettings((prev) => (prev ? { ...prev, [f.k]: e.target.value } : prev))}
                />
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className="routes-explorer__admin-btn"
                disabled={busy}
                onClick={saveSettings}
              >
                Save Settings
              </button>
            </div>
          </div>
        ) : (
          <p className="notion-text notion-text__content notion-semantic-string">
            No Site Settings row found. Run `scripts/provision-site-admin.mjs` once to create the databases.
          </p>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 className="notion-heading notion-semantic-string">Navigation</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="routes-explorer__pill routes-explorer__pill--nav">top</span>
          <button
            type="button"
            className="routes-explorer__admin-btn"
            disabled={busy}
            onClick={() => addNavRow("top")}
          >
            Add top item
          </button>
        </div>
        {renderNavTable(navByGroup.top)}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
          <span className="routes-explorer__pill">more</span>
          <button
            type="button"
            className="routes-explorer__admin-btn"
            disabled={busy}
            onClick={() => addNavRow("more")}
          >
            Add more item
          </button>
        </div>
        {renderNavTable(navByGroup.more)}
      </section>
    </div>
  );
}
