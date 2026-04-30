import { useCallback, useEffect, useMemo, useState } from "react";
import { SettingsSection } from "./config/SettingsSection";
import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import { useSiteAdmin, useSiteAdminEphemeral } from "./state";
import type { ConfigSourceVersion, SiteSettings } from "./types";
import {
  applySettingsPatch,
  clone,
  defaultSettings,
  isGoogleAnalyticsIdDraftValid,
  normalizeGoogleAnalyticsIdDraft,
  normalizeSettings,
  productionReadOnlyMessage,
  settingsPatch,
  settingsPatchConflictKeys,
} from "./utils";

type ConfigSnapshot = {
  sourceVersion: ConfigSourceVersion;
  settings: SiteSettings;
};

function parseConfigSnapshot(payload: Record<string, unknown>): ConfigSnapshot | null {
  const srcVersion = payload.sourceVersion as
    | { siteConfigSha?: string; branchSha?: string }
    | undefined;
  if (!srcVersion?.siteConfigSha || !srcVersion.branchSha) return null;
  return {
    sourceVersion: {
      siteConfigSha: srcVersion.siteConfigSha,
      branchSha: srcVersion.branchSha,
    },
    settings: normalizeSettings(payload.settings),
  };
}

function isSourceConflictResponse(response: { ok: boolean; code?: string; status: number }) {
  return !response.ok && response.code === "SOURCE_CONFLICT";
}

/** Orchestrator for the Config surface: owns load/save state + dirty
 * tracking + conflict handling, and delegates the visual form to a
 * dedicated presentational component under `config/`. */
export function ConfigPanel() {
  const { productionReadOnly, request, setMessage } = useSiteAdmin();
  const { setTopbarSaveAction } = useSiteAdminEphemeral();

  const [sourceVersion, setSourceVersion] = useState<ConfigSourceVersion | null>(null);
  const [baseSettings, setBaseSettings] = useState<SiteSettings>(defaultSettings());
  const [settingsDraft, setSettingsDraft] = useState<SiteSettings>(defaultSettings());
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [savedNeedsPublish, setSavedNeedsPublish] = useState(false);
  const settingsDirty = useMemo(
    () => Object.keys(settingsPatch(baseSettings, settingsDraft)).length > 0,
    [baseSettings, settingsDraft],
  );

  const applyConflict = useCallback(
    (msg: string) => {
      setConflict(true);
      setMessage("warn", `${msg} Reload latest and apply your edit again.`);
    },
    [setMessage],
  );

  const applyConfigSnapshot = useCallback(
    (
      snapshot: ConfigSnapshot,
      options: { preserveSavedNotice?: boolean; settingsDraft?: SiteSettings } = {},
    ) => {
      setSourceVersion(snapshot.sourceVersion);
      setBaseSettings(snapshot.settings);
      setSettingsDraft(options.settingsDraft ?? clone(snapshot.settings));
      setConflict(false);
      if (!options.preserveSavedNotice) setSavedNeedsPublish(false);
    },
    [],
  );

  const fetchConfigSnapshot = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const response = await request("/api/site-admin/config", "GET");
      if (!response.ok) {
        if (!options.silent) {
          setMessage("error", `Load config failed: ${response.code}: ${response.error}`);
        }
        return null;
      }
      const snapshot = parseConfigSnapshot((response.data ?? {}) as Record<string, unknown>);
      if (!snapshot) {
        if (!options.silent) {
          setMessage("error", "Load config failed: missing sourceVersion");
        }
        return null;
      }
      return snapshot;
    },
    [request, setMessage],
  );

  const loadConfig = useCallback(
    async (options: { preserveSavedNotice?: boolean; silent?: boolean } = {}) => {
      setLoading(true);
      const snapshot = await fetchConfigSnapshot(options);
      setLoading(false);
      if (!snapshot) {
        return false;
      }
      applyConfigSnapshot(snapshot, { preserveSavedNotice: options.preserveSavedNotice });
      if (!options.silent) setMessage("success", "Config loaded.");
      return true;
    },
    [applyConfigSnapshot, fetchConfigSnapshot, setMessage],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- Initial config hydration is an async site-admin request; the state updates happen after the request resolves. */
  useEffect(() => {
    void loadConfig({ silent: true });
  }, [loadConfig]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveSettings = useCallback(async () => {
    if (productionReadOnly) {
      setMessage(
        "warn",
        productionReadOnlyMessage("save settings"),
      );
      return;
    }
    if (conflict) {
      setMessage("warn", "Config is in conflict state. Reload latest before saving.");
      return;
    }
    if (!sourceVersion?.siteConfigSha) {
      setMessage("error", "Config sourceVersion missing. Reload config first.");
      return;
    }
    if (!isGoogleAnalyticsIdDraftValid(settingsDraft.googleAnalyticsId)) {
      setMessage(
        "error",
        "Google Analytics ID must look like G-XXXXXXXXXX, or be blank.",
      );
      return;
    }
    const normalizedDraft = {
      ...settingsDraft,
      googleAnalyticsId: normalizeGoogleAnalyticsIdDraft(
        settingsDraft.googleAnalyticsId,
      ),
    };
    const patch = settingsPatch(baseSettings, normalizedDraft);
    if (!Object.keys(patch).length) {
      setMessage("warn", "No setting changes to save.");
      return;
    }
    if (!baseSettings.rowId) {
      setMessage("error", "Settings rowId missing. Reload config first.");
      return;
    }
    const postSettingsPatch = (
      rowId: string,
      nextPatch: Partial<SiteSettings>,
      expectedSiteConfigSha: string,
    ) =>
      request("/api/site-admin/config", "POST", {
        kind: "settings",
        rowId,
        patch: nextPatch,
        expectedSiteConfigSha,
        allowStaleSiteConfigSha: true,
      });

    setSavingSettings(true);
    const response = await postSettingsPatch(
      baseSettings.rowId,
      patch,
      sourceVersion.siteConfigSha,
    );
    if (isSourceConflictResponse(response)) {
      setMessage("warn", "Config changed on source branch. Reloading latest and retrying your setting change.");
      const latest = await fetchConfigSnapshot({ silent: true });
      if (!latest) {
        setSavingSettings(false);
        applyConflict("Save settings failed with SOURCE_CONFLICT and latest config could not be loaded.");
        return;
      }
      const conflictKeys = settingsPatchConflictKeys(baseSettings, latest.settings, patch);
      const mergedDraft = applySettingsPatch(latest.settings, patch);
      if (conflictKeys.length > 0) {
        applyConfigSnapshot(latest, { settingsDraft: mergedDraft });
        setSavingSettings(false);
        applyConflict(
          `Save settings stopped because latest config changed the same field(s): ${conflictKeys.join(", ")}.`,
        );
        return;
      }
      const retryPatch = settingsPatch(latest.settings, mergedDraft);
      if (!Object.keys(retryPatch).length) {
        applyConfigSnapshot(latest);
        setSavingSettings(false);
        setSavedNeedsPublish(true);
        setMessage("success", "Latest config already contains your settings.");
        return;
      }
      const retryResponse = await postSettingsPatch(
        latest.settings.rowId,
        retryPatch,
        latest.sourceVersion.siteConfigSha,
      );
      if (!retryResponse.ok) {
        applyConfigSnapshot(latest, { settingsDraft: mergedDraft });
        setSavingSettings(false);
        if (isSourceConflictResponse(retryResponse)) {
          applyConflict("Save settings failed with SOURCE_CONFLICT after reloading latest.");
          return;
        }
        setMessage(
          "error",
          `Save settings failed after reload: ${retryResponse.code}: ${retryResponse.error}`,
        );
        return;
      }
      setSavingSettings(false);
      setMessage(
        "success",
        "Settings saved to source branch after refreshing latest config. Publish staging separately.",
      );
      setSavedNeedsPublish(true);
      await loadConfig({ preserveSavedNotice: true, silent: true });
      return;
    }
    setSavingSettings(false);
    if (!response.ok) {
      setMessage("error", `Save settings failed: ${response.code}: ${response.error}`);
      return;
    }
    setSavedNeedsPublish(true);
    setMessage("success", "Settings saved to source branch. Publish staging separately.");
    await loadConfig({ preserveSavedNotice: true, silent: true });
  }, [
    conflict,
    productionReadOnly,
    sourceVersion,
    baseSettings,
    settingsDraft,
    request,
    setMessage,
    applyConflict,
    applyConfigSnapshot,
    fetchConfigSnapshot,
    loadConfig,
  ]);

  const updateDraft = useCallback(
    <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
      setSavedNeedsPublish(false);
      setSettingsDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  useEffect(() => {
    setTopbarSaveAction({
      dirty: settingsDirty,
      disabled:
        loading ||
        savingSettings ||
        conflict ||
        !sourceVersion ||
        productionReadOnly,
      label: "Save Settings",
      onSave: () => {
        void saveSettings();
      },
      saving: savingSettings,
      title: productionReadOnly
        ? "Production is inspect-only. Switch to Staging to save site settings."
        : conflict
          ? "Reload latest before saving settings."
          : undefined,
    });
    return () => setTopbarSaveAction(null);
  }, [
    conflict,
    loading,
    productionReadOnly,
    saveSettings,
    savingSettings,
    setTopbarSaveAction,
    settingsDirty,
    sourceVersion,
  ]);

  const stateNote = loading
    ? "Loading config…"
    : conflict
      ? "Conflict detected (SOURCE_CONFLICT). Reload latest before saving again."
      : sourceVersion
        ? `Dirty state: settings=${settingsDirty ? "yes" : "no"}`
        : "Config not loaded.";

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Site Settings
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Site identity, analytics, social cards, and SEO defaults.
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
            title={
              productionReadOnly
                ? "Production is inspect-only. Switch to Staging to save site settings."
                : undefined
            }
            disabled={loading || savingSettings || conflict || !sourceVersion || productionReadOnly}
          >
            {productionReadOnly ? "Read-only in Production" : "Save Site Settings"}
          </button>
        </div>
      </header>
      <SiteAdminEnvironmentBanner actionLabel="save site settings" />
      {productionReadOnly ? (
        <div className="settings-readonly-callout" role="status">
          <strong>Production settings are locked in Workspace.</strong>
          <span>
            Edit Settings in Staging, publish the staging candidate, then promote
            production with the release runbook.
          </span>
        </div>
      ) : null}
      {savedNeedsPublish ? (
        <div className="settings-save-hint" role="status">
          <strong>Saved to source.</strong>
          <span>Use the topbar Publish button to update the public staging site.</span>
        </div>
      ) : null}
      <p className="m-0 text-[12px] text-text-muted">
        {sourceVersion
          ? `sourceVersion.siteConfigSha=${sourceVersion.siteConfigSha} | branchSha=${sourceVersion.branchSha}`
          : "sourceVersion: -"}
      </p>
      <p className="m-0 text-[12px] text-text-muted">{stateNote}</p>

      <SettingsSection
        settingsDraft={settingsDraft}
        onUpdate={updateDraft}
        readOnly={productionReadOnly}
      />

    </section>
  );
}
