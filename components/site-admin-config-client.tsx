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
  contentGithubUsers: string;
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

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
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
  const [openNav, setOpenNav] = useState<Record<string, boolean>>({});

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
          setOpenNav({});
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
        contentGithubUsers: draftSettings.contentGithubUsers,
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

  const clearNavDraft = (rowId: string) => {
    setNavDraft((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  };

  const toggleOpenNav = (rowId: string) => {
    setOpenNav((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
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
      if (created?.rowId) {
        setNav((prev) => [...prev, created].sort((a, b) => a.order - b.order));
        setOpenNav((prev) => ({ ...prev, [created.rowId]: true }));
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const renderNavList = (rows: NavItemRow[], group: "top" | "more") => (
    <div className="site-admin-nav" role="list" aria-label={`Navigation (${group})`}>
      {rows.map((it) => {
        const open = Boolean(openNav[it.rowId]);
        const d = navDraft[it.rowId] || {};
        const dirty = Object.keys(d).length > 0;
        const label = asString(d.label ?? it.label);
        const href = asString(d.href ?? it.href);
        const order = asNumber(d.order ?? it.order);
        const enabled = Boolean(d.enabled ?? it.enabled);

        return (
          <div key={it.rowId} className="site-admin-nav__row" role="listitem" data-open={open ? "1" : "0"}>
            <div className="site-admin-nav__row-top">
              <div className="site-admin-nav__left">
                <button
                  type="button"
                  className="site-admin-nav__expander"
                  aria-label={open ? "Collapse item" : "Expand item"}
                  aria-expanded={open}
                  onClick={() => toggleOpenNav(it.rowId)}
                  title={open ? "Collapse" : "Expand"}
                >
                  <svg className="site-admin-nav__chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                <div className="site-admin-nav__text">
                  <div className="site-admin-nav__headline">
                    <span className="site-admin-nav__label">{label || "Untitled"}</span>
                    <span className="site-admin-nav__href">{href || "(missing href)"}</span>
                  </div>
                  <div className="site-admin-nav__subline">
                    <code className="site-admin-nav__id">{it.rowId}</code>
                    <button
                      type="button"
                      className="site-admin-nav__copy"
                      onClick={() => copyToClipboard(it.rowId)}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>

              <div className="site-admin-nav__right">
                <span className="routes-explorer__pill routes-explorer__pill--nav">#{order}</span>
                <label className="site-admin-nav__switch">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => updateNavDraftField(it.rowId, { enabled: e.target.checked })}
                    aria-label="Enabled"
                  />
                  <span>Enabled</span>
                </label>
              </div>
            </div>

            {open ? (
              <div className="site-admin-nav__panel">
                <div className="site-admin-form site-admin-form--compact" role="group" aria-label="Edit item">
                  <div className="site-admin-form__row">
                    <label className="site-admin-form__label">Label</label>
                    <input
                      className="site-admin-form__input"
                      value={label}
                      onChange={(e) => updateNavDraftField(it.rowId, { label: e.target.value })}
                      placeholder="Home"
                    />
                  </div>

                  <div className="site-admin-form__row">
                    <label className="site-admin-form__label">Href</label>
                    <input
                      className="site-admin-form__input site-admin-form__input--mono"
                      value={href}
                      onChange={(e) => updateNavDraftField(it.rowId, { href: e.target.value })}
                      placeholder="/blog"
                    />
                  </div>

                  <div className="site-admin-form__row">
                    <label className="site-admin-form__label">Order</label>
                    <input
                      className="site-admin-form__input site-admin-form__input--mono"
                      inputMode="numeric"
                      value={String(order)}
                      onChange={(e) => updateNavDraftField(it.rowId, { order: asNumber(e.target.value) })}
                    />
                  </div>

                  <div className="site-admin-form__actions">
                    <button
                      type="button"
                      className="site-admin-form__btn"
                      disabled={busy || !dirty}
                      onClick={() => saveNavRow(it)}
                      title={dirty ? "Save changes" : "No changes"}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className={cn("site-admin-form__btn", dirty ? "" : "is-muted")}
                      disabled={busy || !dirty}
                      onClick={() => clearNavDraft(it.rowId)}
                      title="Discard local edits"
                    >
                      Revert
                    </button>
                    <button
                      type="button"
                      className="site-admin-form__btn"
                      disabled={busy}
                      onClick={() => toggleOpenNav(it.rowId)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="site-admin-config">
      <section>
        <h2 className="notion-heading notion-semantic-string">Config</h2>
        <p className="notion-text notion-text__content notion-semantic-string">
          Edits here write to your site settings. Changes take effect after you click Deploy.
        </p>
      </section>

      {err ? <div className="routes-explorer__error">{err}</div> : null}

      <section className="site-admin-config__section">
        <h3 className="notion-heading notion-semantic-string">Site Settings</h3>
        {draftSettings ? (
          <div className="site-admin-form" role="form" aria-label="Site settings">
            <div className="site-admin-form__row">
              <label className="site-admin-form__label">Site Name</label>
              <input
                className="site-admin-form__input"
                value={asString(draftSettings.siteName)}
                onChange={(e) => setDraftSettings((prev) => (prev ? { ...prev, siteName: e.target.value } : prev))}
                placeholder="Jinkun Chen."
              />
            </div>

            <div className="site-admin-form__row">
              <label className="site-admin-form__label">Lang</label>
              <input
                className="site-admin-form__input site-admin-form__input--mono"
                value={asString(draftSettings.lang)}
                onChange={(e) => setDraftSettings((prev) => (prev ? { ...prev, lang: e.target.value } : prev))}
                placeholder="en"
              />
            </div>

            <div className="site-admin-form__row">
              <label className="site-admin-form__label">SEO Title</label>
              <input
                className="site-admin-form__input"
                value={asString(draftSettings.seoTitle)}
                onChange={(e) => setDraftSettings((prev) => (prev ? { ...prev, seoTitle: e.target.value } : prev))}
                placeholder="Jinkun Chen"
              />
            </div>

            <div className="site-admin-form__row">
              <label className="site-admin-form__label">SEO Description</label>
              <textarea
                className="site-admin-form__textarea"
                value={asString(draftSettings.seoDescription)}
                onChange={(e) =>
                  setDraftSettings((prev) => (prev ? { ...prev, seoDescription: e.target.value } : prev))
                }
                placeholder="Short description for search engines."
              />
            </div>

            <div className="site-admin-form__row">
              <label className="site-admin-form__label">Favicon</label>
              <input
                className="site-admin-form__input"
                value={asString(draftSettings.favicon)}
                onChange={(e) => setDraftSettings((prev) => (prev ? { ...prev, favicon: e.target.value } : prev))}
                placeholder="/favicon.ico"
              />
            </div>

            <div className="site-admin-form__row">
              <label className="site-admin-form__label">Google Analytics ID</label>
              <input
                className="site-admin-form__input site-admin-form__input--mono"
                value={asString(draftSettings.googleAnalyticsId)}
                onChange={(e) =>
                  setDraftSettings((prev) => (prev ? { ...prev, googleAnalyticsId: e.target.value } : prev))
                }
                placeholder="G-XXXXXXXXXX"
              />
            </div>

            <div className="site-admin-form__row">
              <label className="site-admin-form__label">Content GitHub Users</label>
              <textarea
                className="site-admin-form__textarea site-admin-form__textarea--mono"
                value={asString(draftSettings.contentGithubUsers)}
                onChange={(e) =>
                  setDraftSettings((prev) => (prev ? { ...prev, contentGithubUsers: e.target.value } : prev))
                }
                placeholder="comma-separated GitHub usernames (e.g. jinnkunn, alice, bob)"
              />
            </div>

            <div className="site-admin-form__row">
              <label className="site-admin-form__label">Root Page ID</label>
              <input
                className="site-admin-form__input site-admin-form__input--mono"
                value={asString(draftSettings.rootPageId)}
                onChange={(e) =>
                  setDraftSettings((prev) => (prev ? { ...prev, rootPageId: e.target.value } : prev))
                }
                placeholder="Page ID"
              />
            </div>

            <div className="site-admin-form__row">
              <label className="site-admin-form__label">Home Page ID</label>
              <input
                className="site-admin-form__input site-admin-form__input--mono"
                value={asString(draftSettings.homePageId)}
                onChange={(e) =>
                  setDraftSettings((prev) => (prev ? { ...prev, homePageId: e.target.value } : prev))
                }
                placeholder="Page ID"
              />
            </div>

            <div className="site-admin-form__actions">
              <button type="button" className="site-admin-form__btn" disabled={busy} onClick={saveSettings}>
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

      <section className="site-admin-config__section">
        <h3 className="notion-heading notion-semantic-string">Navigation</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="routes-explorer__pill routes-explorer__pill--nav">top</span>
          <button
            type="button"
            className="site-admin-form__btn"
            disabled={busy}
            onClick={() => addNavRow("top")}
          >
            Add top item
          </button>
        </div>
        {renderNavList(navByGroup.top, "top")}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
          <span className="routes-explorer__pill">more</span>
          <button
            type="button"
            className="site-admin-form__btn"
            disabled={busy}
            onClick={() => addNavRow("more")}
          >
            Add more item
          </button>
        </div>
        {renderNavList(navByGroup.more, "more")}
      </section>
    </div>
  );
}
