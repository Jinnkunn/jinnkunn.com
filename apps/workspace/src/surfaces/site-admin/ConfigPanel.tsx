import { useCallback, useMemo, useState } from "react";
import { BLANK_NEW_NAV, NavSection, type NewNavInput } from "./config/NavSection";
import { SettingsSection } from "./config/SettingsSection";
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
} from "./utils";

/** Orchestrator for the Config surface: owns load/save state + dirty
 * tracking + conflict handling, and delegates the two visual sections
 * (Site Settings form, Navigation Rows table + create form) to
 * dedicated presentational components under `config/`. */
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

  const updateDraft = useCallback(
    <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
      setSettingsDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

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
            Settings &amp; Navigation
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

      <SettingsSection settingsDraft={settingsDraft} onUpdate={updateDraft} />

      <NavSection
        navRows={navRows}
        navDrafts={navDrafts}
        navSaving={navSaving}
        conflict={conflict}
        creatingNav={creatingNav}
        loading={loading}
        sourceVersion={sourceVersion}
        newNav={newNav}
        setNewNav={setNewNav}
        updateNavDraft={updateNavDraft}
        saveNavRow={(rowId) => void saveNavRow(rowId)}
        createNavRow={() => void createNavRow()}
      />
    </section>
  );
}
