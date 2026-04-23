import { useCallback, useMemo, useState } from "react";
import { SeoOverridesEditor } from "./SeoOverridesEditor";
import { useSiteAdmin } from "./state";
import type { ConfigSourceVersion, NavRow, SiteSettings } from "./types";
import {
  clone,
  defaultSettings,
  isNavDirty,
  navPatch,
  normalizeNavRow,
  normalizeSettings,
  settingsPatch,
  toInteger,
} from "./utils";

// Text fields on the settings object — rendered as a grid. Boolean
// fields are pulled out separately so we can use a <select> variant.
const TEXT_FIELDS: readonly {
  key: keyof SiteSettings;
  label: string;
  wide?: boolean;
  textarea?: boolean;
}[] = [
  { key: "siteName", label: "Site Name" },
  { key: "lang", label: "Language" },
  { key: "seoTitle", label: "SEO Title" },
  { key: "seoDescription", label: "SEO Description", textarea: true },
  { key: "favicon", label: "Favicon URL" },
  { key: "ogImage", label: "OG Image URL" },
  { key: "googleAnalyticsId", label: "Google Analytics ID" },
  { key: "contentGithubUsers", label: "Content GitHub Users", textarea: true },
  { key: "rootPageId", label: "Root Page ID" },
  { key: "homePageId", label: "Home Page ID" },
  { key: "seoPageOverrides", label: "SEO Page Overrides (JSON)", wide: true, textarea: true },
  { key: "sitemapExcludes", label: "Sitemap Excludes", wide: true, textarea: true },
  { key: "sitemapAutoExcludeSections", label: "Sitemap Auto Exclude Sections" },
  { key: "sitemapAutoExcludeDepthPages", label: "Sitemap Auto Exclude Depth Pages" },
  { key: "sitemapAutoExcludeDepthBlog", label: "Sitemap Auto Exclude Depth Blog" },
  { key: "sitemapAutoExcludeDepthPublications", label: "Sitemap Auto Exclude Depth Publications" },
  { key: "sitemapAutoExcludeDepthTeaching", label: "Sitemap Auto Exclude Depth Teaching" },
];

interface NewNavInput {
  label: string;
  href: string;
  group: "top" | "more";
  order: number;
  enabled: boolean;
}

const BLANK_NEW_NAV: NewNavInput = {
  label: "",
  href: "",
  group: "top",
  order: 0,
  enabled: true,
};

export function ConfigPanel() {
  const { request, setMessage } = useSiteAdmin();

  const [sourceVersion, setSourceVersion] = useState<ConfigSourceVersion | null>(null);
  const [baseSettings, setBaseSettings] = useState<SiteSettings>(defaultSettings());
  const [settingsDraft, setSettingsDraft] = useState<SiteSettings>(defaultSettings());
  const [navRows, setNavRows] = useState<NavRow[]>([]);
  const [navDrafts, setNavDrafts] = useState<Record<string, NavRow>>({});
  const [navSaving, setNavSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingNav, setCreatingNav] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [newNav, setNewNav] = useState<NewNavInput>(BLANK_NEW_NAV);

  const settingsDirty = useMemo(
    () => Object.keys(settingsPatch(baseSettings, settingsDraft)).length > 0,
    [baseSettings, settingsDraft],
  );

  const anyNavDirty = useMemo(
    () =>
      navRows.some((row) => {
        const draft = navDrafts[row.rowId];
        return draft ? isNavDirty(row, draft) : false;
      }),
    [navRows, navDrafts],
  );

  const applyConflict = useCallback(
    (msg: string) => {
      setConflict(true);
      setMessage("warn", `${msg} Reload latest and apply your edit again.`);
    },
    [setMessage],
  );

  const loadConfig = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      const response = await request("/api/site-admin/config", "GET");
      setLoading(false);
      if (!response.ok) {
        if (!options.silent) {
          setMessage("error", `Load config failed: ${response.code}: ${response.error}`);
        }
        return false;
      }
      const payload = (response.data ?? {}) as Record<string, unknown>;
      const srcVersion = payload.sourceVersion as
        | { siteConfigSha?: string; branchSha?: string }
        | undefined;
      if (!srcVersion?.siteConfigSha || !srcVersion.branchSha) {
        if (!options.silent) {
          setMessage("error", "Load config failed: missing sourceVersion");
        }
        return false;
      }
      const settings = normalizeSettings(payload.settings);
      const nav = Array.isArray(payload.nav) ? payload.nav.map(normalizeNavRow) : [];
      setSourceVersion({
        siteConfigSha: srcVersion.siteConfigSha,
        branchSha: srcVersion.branchSha,
      });
      setBaseSettings(settings);
      setSettingsDraft(clone(settings));
      setNavRows(nav);
      setNavDrafts(Object.fromEntries(nav.map((row) => [row.rowId, clone(row)])));
      setNavSaving({});
      setConflict(false);
      if (!options.silent) setMessage("success", "Config loaded.");
      return true;
    },
    [request, setMessage],
  );

  const saveSettings = useCallback(async () => {
    if (conflict) {
      setMessage("warn", "Config is in conflict state. Reload latest before saving.");
      return;
    }
    if (!sourceVersion?.siteConfigSha) {
      setMessage("error", "Config sourceVersion missing. Reload config first.");
      return;
    }
    const patch = settingsPatch(baseSettings, settingsDraft);
    if (!Object.keys(patch).length) {
      setMessage("warn", "No setting changes to save.");
      return;
    }
    if (!baseSettings.rowId) {
      setMessage("error", "Settings rowId missing. Reload config first.");
      return;
    }
    setSavingSettings(true);
    const response = await request("/api/site-admin/config", "POST", {
      kind: "settings",
      rowId: baseSettings.rowId,
      patch,
      expectedSiteConfigSha: sourceVersion.siteConfigSha,
    });
    setSavingSettings(false);
    if (!response.ok) {
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        applyConflict("Save settings failed with SOURCE_CONFLICT.");
        return;
      }
      setMessage("error", `Save settings failed: ${response.code}: ${response.error}`);
      return;
    }
    setMessage("success", "Settings saved to source branch. Deploy separately.");
    await loadConfig({ silent: true });
  }, [
    conflict,
    sourceVersion,
    baseSettings,
    settingsDraft,
    request,
    setMessage,
    applyConflict,
    loadConfig,
  ]);

  const saveNavRow = useCallback(
    async (rowId: string) => {
      if (conflict) {
        setMessage("warn", "Config is in conflict state. Reload latest before saving.");
        return;
      }
      if (!sourceVersion?.siteConfigSha) {
        setMessage("error", "Config sourceVersion missing. Reload config first.");
        return;
      }
      const base = navRows.find((row) => row.rowId === rowId);
      const draft = navDrafts[rowId];
      if (!base || !draft) {
        setMessage("error", "Nav row not found. Reload config first.");
        return;
      }
      const patch = navPatch(base, draft);
      if (!Object.keys(patch).length) {
        setMessage("warn", `No navigation changes for row ${rowId}.`);
        return;
      }
      setNavSaving((prev) => ({ ...prev, [rowId]: true }));
      const response = await request("/api/site-admin/config", "POST", {
        kind: "nav-update",
        rowId,
        patch,
        expectedSiteConfigSha: sourceVersion.siteConfigSha,
      });
      setNavSaving((prev) => ({ ...prev, [rowId]: false }));
      if (!response.ok) {
        if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
          applyConflict(`Save nav row ${rowId} failed with SOURCE_CONFLICT.`);
          return;
        }
        setMessage("error", `Save nav row failed: ${response.code}: ${response.error}`);
        return;
      }
      setMessage("success", `Navigation row ${rowId} saved to source branch.`);
      await loadConfig({ silent: true });
    },
    [conflict, sourceVersion, navRows, navDrafts, request, setMessage, applyConflict, loadConfig],
  );

  const createNavRow = useCallback(async () => {
    if (conflict) {
      setMessage(
        "warn",
        "Config is in conflict state. Reload latest before creating nav rows.",
      );
      return;
    }
    if (!sourceVersion?.siteConfigSha) {
      setMessage("error", "Config sourceVersion missing. Reload config first.");
      return;
    }
    if (!newNav.label || !newNav.href) {
      setMessage("error", "Nav create requires both label and href.");
      return;
    }
    setCreatingNav(true);
    const response = await request("/api/site-admin/config", "POST", {
      kind: "nav-create",
      input: newNav,
      expectedSiteConfigSha: sourceVersion.siteConfigSha,
    });
    setCreatingNav(false);
    if (!response.ok) {
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        applyConflict("Create nav row failed with SOURCE_CONFLICT.");
        return;
      }
      setMessage("error", `Create nav row failed: ${response.code}: ${response.error}`);
      return;
    }
    setNewNav(BLANK_NEW_NAV);
    setMessage("success", "Navigation row created on source branch.");
    await loadConfig({ silent: true });
  }, [conflict, sourceVersion, newNav, request, setMessage, applyConflict, loadConfig]);

  const updateDraft = useCallback(<K extends keyof SiteSettings>(
    key: K,
    value: SiteSettings[K],
  ) => {
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateNavDraft = useCallback(
    <K extends keyof NavRow>(rowId: string, key: K, value: NavRow[K]) => {
      setNavDrafts((prev) => {
        const existing = prev[rowId];
        if (!existing) return prev;
        return { ...prev, [rowId]: { ...existing, [key]: value } };
      });
    },
    [],
  );

  const stateNote = loading
    ? "Loading config…"
    : conflict
      ? "Conflict detected (SOURCE_CONFLICT). Reload latest before saving again."
      : sourceVersion
        ? `Dirty state: settings=${settingsDirty ? "yes" : "no"}, nav=${anyNavDirty ? "yes" : "no"}`
        : "Config not loaded.";

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Config
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Site settings + navigation rows served to the public site.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadConfig()}
            disabled={loading}
          >
            Reload Latest
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void saveSettings()}
            disabled={loading || savingSettings || conflict || !sourceVersion}
          >
            Save Site Settings
          </button>
        </div>
      </header>
      <p className="m-0 text-[12px] text-text-muted">
        {sourceVersion
          ? `sourceVersion.siteConfigSha=${sourceVersion.siteConfigSha} | branchSha=${sourceVersion.branchSha}`
          : "sourceVersion: -"}
      </p>
      <p className="m-0 text-[12px] text-text-muted">{stateNote}</p>

      <details className="surface-details" open>
        <summary>Site Settings</summary>
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          {TEXT_FIELDS.map((field) => (
            <label
              key={field.key}
              className="flex flex-col gap-1 text-[12px] text-text-secondary"
              style={field.wide ? { gridColumn: "1 / -1" } : undefined}
            >
              {field.label}
              {field.textarea ? (
                <textarea
                  rows={3}
                  value={settingsDraft[field.key] as string}
                  onChange={(e) => updateDraft(field.key, e.target.value as never)}
                />
              ) : (
                <input
                  value={settingsDraft[field.key] as string}
                  onChange={(e) => updateDraft(field.key, e.target.value as never)}
                />
              )}
            </label>
          ))}
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Sitemap Auto Exclude Enabled
            <select
              value={settingsDraft.sitemapAutoExcludeEnabled ? "true" : "false"}
              onChange={(e) =>
                updateDraft("sitemapAutoExcludeEnabled", e.target.value === "true")
              }
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <SeoOverridesEditor
            value={settingsDraft.seoPageOverrides}
            onChange={(next) => updateDraft("seoPageOverrides", next as never)}
          />
        </div>
      </details>

      <details className="surface-details" open>
        <summary>Navigation Rows</summary>
        <div className="flex flex-col gap-2 mt-1">
          {navRows.length === 0 ? (
            <p className="empty-note">No navigation rows.</p>
          ) : (
            <>
              <div className="grid-row grid-header">
                <span>Label</span>
                <span>Href</span>
                <span>Group</span>
                <span>Order</span>
                <span>Enabled</span>
                <span>Action</span>
              </div>
              {navRows.map((row) => {
                const draft = navDrafts[row.rowId] ?? row;
                const dirty = isNavDirty(row, draft);
                const saving = Boolean(navSaving[row.rowId]);
                return (
                  <div className="grid-row" key={row.rowId}>
                    <input
                      value={draft.label}
                      placeholder="Label"
                      onChange={(e) =>
                        updateNavDraft(row.rowId, "label", e.target.value)
                      }
                    />
                    <input
                      value={draft.href}
                      placeholder="/path"
                      onChange={(e) =>
                        updateNavDraft(row.rowId, "href", e.target.value)
                      }
                    />
                    <select
                      value={draft.group}
                      onChange={(e) =>
                        updateNavDraft(
                          row.rowId,
                          "group",
                          e.target.value === "top" ? "top" : "more",
                        )
                      }
                    >
                      <option value="top">top</option>
                      <option value="more">more</option>
                    </select>
                    <input
                      type="number"
                      value={draft.order}
                      onChange={(e) =>
                        updateNavDraft(row.rowId, "order", toInteger(e.target.value, 0))
                      }
                    />
                    <select
                      value={draft.enabled ? "true" : "false"}
                      onChange={(e) =>
                        updateNavDraft(row.rowId, "enabled", e.target.value === "true")
                      }
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn--secondary"
                        type="button"
                        disabled={conflict || saving}
                        onClick={() => void saveNavRow(row.rowId)}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <span className={`row-note ${dirty ? "dirty" : "clean"}`}>
                        {dirty ? "unsaved" : "saved"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <h3 className="mt-4 mb-2 text-[13px] font-semibold text-text-primary">
          Create Navigation Row
        </h3>
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Label
            <input
              value={newNav.label}
              onChange={(e) => setNewNav({ ...newNav, label: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Href
            <input
              value={newNav.href}
              onChange={(e) => setNewNav({ ...newNav, href: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Group
            <select
              value={newNav.group}
              onChange={(e) =>
                setNewNav({
                  ...newNav,
                  group: e.target.value === "top" ? "top" : "more",
                })
              }
            >
              <option value="top">top</option>
              <option value="more">more</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Order
            <input
              type="number"
              value={newNav.order}
              onChange={(e) =>
                setNewNav({ ...newNav, order: toInteger(e.target.value, 0) })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Enabled
            <select
              value={newNav.enabled ? "true" : "false"}
              onChange={(e) =>
                setNewNav({ ...newNav, enabled: e.target.value === "true" })
              }
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            className="btn"
            type="button"
            disabled={loading || creatingNav || conflict || !sourceVersion}
            onClick={() => void createNavRow()}
          >
            Create Nav Row
          </button>
        </div>
      </details>
    </section>
  );
}
