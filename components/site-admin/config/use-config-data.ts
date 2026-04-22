"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { NavItemRow, SiteSettings } from "@/components/site-admin/config/types";
import { errorFromUnknown } from "@/components/site-admin/config/utils";
import { useSiteAdminNavMutations } from "@/components/site-admin/config/use-nav-mutations";
import { useSiteAdminSettingsMutation } from "@/components/site-admin/config/use-settings-mutation";
import { useUnsavedChangesGuard } from "@/components/site-admin/use-unsaved-changes-guard";
import { requestJsonOrThrow } from "@/lib/client/request-json";
import type { SiteAdminSourceVersion } from "@/lib/site-admin/api-types";
import { isSiteAdminConfigGetOk, parseSiteAdminConfigGet } from "@/lib/site-admin/config-contract";
import {
  countDirtyNavRows,
  deriveEditorStatus,
  hasSiteSettingsChanges,
  IDLE_EDITOR_RESULT,
  type SiteAdminEditorResultState,
} from "@/lib/site-admin/editor-state";

export function useSiteAdminConfigData() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nav, setNav] = useState<NavItemRow[]>([]);
  const [savedSettings, setSavedSettings] = useState<SiteSettings | null>(null);
  const [draftSettings, setDraftSettings] = useState<SiteSettings | null>(null);
  const [sourceVersion, setSourceVersion] = useState<SiteAdminSourceVersion | null>(null);
  const [editorResult, setEditorResult] = useState<SiteAdminEditorResultState>(IDLE_EDITOR_RESULT);
  const conflictLocked = editorResult.kind === "conflict";
  const clearEditorResultOnEdit = useCallback(() => {
    setEditorResult((prev) => (prev.kind === "saved" || prev.kind === "error" ? IDLE_EDITOR_RESULT : prev));
  }, []);
  const {
    openNav,
    navDraft,
    resetNavEditorState,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    addNavRow,
  } = useSiteAdminNavMutations({
    setBusy,
    setNav,
    sourceVersion,
    setSourceVersion,
    setEditorResult,
    clearEditorResultOnEdit,
    conflictLocked,
  });
  const loadLatest = useCallback(async (opts?: { resetEditorResult?: boolean }) => {
    setBusy(true);
    setErr("");
    try {
      const data = await requestJsonOrThrow(
        "/api/site-admin/config",
        { cache: "no-store" },
        parseSiteAdminConfigGet,
        { isOk: isSiteAdminConfigGetOk },
      );
      setSavedSettings(data.settings ? { ...data.settings } : null);
      setDraftSettings(data.settings ? { ...data.settings } : null);
      setNav(data.nav || []);
      setSourceVersion(data.sourceVersion);
      resetNavEditorState();
      if (opts?.resetEditorResult !== false) {
        setEditorResult({
          kind: "idle",
          message: "Latest source loaded from GitHub main.",
        });
      }
    } catch (e: unknown) {
      setErr(errorFromUnknown(e));
    } finally {
      setBusy(false);
    }
  }, [resetNavEditorState]);
  const saveSettings = useSiteAdminSettingsMutation({
    draftSettings,
    sourceVersion,
    setSourceVersion,
    setSavedSettings,
    setEditorResult,
    setBusy,
    conflictLocked,
  });

  useEffect(() => {
    void loadLatest({ resetEditorResult: false });
  }, [loadLatest]);

  const updateDraftSettings = useCallback((
    value: SiteSettings | null | ((prev: SiteSettings | null) => SiteSettings | null),
  ) => {
    clearEditorResultOnEdit();
    setDraftSettings(value);
  }, [clearEditorResultOnEdit]);

  const navByGroup = useMemo(() => {
    const top = nav.filter((x) => x.group === "top");
    const more = nav.filter((x) => x.group === "more");
    return { top, more };
  }, [nav]);

  const dirtyNavRows = useMemo(() => countDirtyNavRows(nav, navDraft), [nav, navDraft]);
  const settingsDirty = hasSiteSettingsChanges(savedSettings, draftSettings);
  const hasUnsavedChanges = settingsDirty || dirtyNavRows > 0;
  const status = deriveEditorStatus({
    hasUnsavedChanges,
    result: editorResult,
    dirtyMessage:
      dirtyNavRows > 0 && settingsDirty
        ? `You have unsaved settings and navigation changes (${dirtyNavRows} nav row${dirtyNavRows === 1 ? "" : "s"}).`
        : settingsDirty
          ? "You have unsaved site settings changes."
          : `You have unsaved navigation changes (${dirtyNavRows} row${dirtyNavRows === 1 ? "" : "s"}).`,
  });

  useUnsavedChangesGuard({
    enabled: hasUnsavedChanges,
  });

  return {
    busy,
    err,
    nav,
    openNav,
    status,
    conflictLocked,
    hasUnsavedChanges,
    draftSettings,
    navDraft,
    navByGroup,
    updateDraftSettings,
    saveSettings,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    addNavRow,
    loadLatest,
  };
}
