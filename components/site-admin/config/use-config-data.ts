"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { settingsDraftDirty } from "@/app/site-admin/site-admin-console-model";
import type { NavItemRow, SiteSettings } from "@/components/site-admin/config/types";
import { errorFromUnknown } from "@/components/site-admin/config/utils";
import { useSiteAdminNavMutations } from "@/components/site-admin/config/use-nav-mutations";
import { useSiteAdminSettingsMutation } from "@/components/site-admin/config/use-settings-mutation";
import { siteAdminBackend } from "@/lib/client/site-admin-backend";
import type { SiteAdminConfigSourceVersion } from "@jinnkunn/contracts/api";

export function useSiteAdminConfigData() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nav, setNav] = useState<NavItemRow[]>([]);
  const [draftSettings, setDraftSettings] = useState<SiteSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<SiteSettings | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [sourceVersion, setVersion] = useState<SiteAdminConfigSourceVersion | null>(null);
  const versionRef = useRef(sourceVersion);
  const setSourceVersion = (version: SiteAdminConfigSourceVersion) => {
    versionRef.current = version;
    setVersion(version);
  };
  const {
    openNav,
    navDraft,
    resetNavEditorState,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    saveAllNavRows,
    addNavRow,
  } = useSiteAdminNavMutations({
    setBusy,
    setErr,
    setNav,
    sourceVersion,
    setSourceVersion,
  });
  const saveSettings = useSiteAdminSettingsMutation({
    draftSettings,
    setBusy,
    setErr,
    sourceVersion,
    setSourceVersion,
    onSaved: (saved) => {
      setSavedSettings(saved);
      setSavedAt(new Date().toISOString());
    },
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setErr("");
      try {
        const data = await siteAdminBackend.getConfig();
        if (!cancelled) {
          setDraftSettings(data.settings ? { ...data.settings } : null);
          setSavedSettings(data.settings ? { ...data.settings } : null);
          setNav(data.nav || []);
          setSourceVersion(data.sourceVersion);
          resetNavEditorState();
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(errorFromUnknown(e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [resetNavEditorState]);

  const navByGroup = useMemo(() => {
    const top = nav.filter((x) => x.group === "top");
    const more = nav.filter((x) => x.group === "more");
    return { top, more };
  }, [nav]);

  const settingsDirty = useMemo(
    () => settingsDraftDirty(savedSettings, draftSettings),
    [draftSettings, savedSettings],
  );

  async function saveDrafts() {
    if (busy) return false;
    if (settingsDirty && !await saveSettings(versionRef.current)) return false;
    return saveAllNavRows(versionRef.current);
  }

  function discardDrafts() {
    setDraftSettings(savedSettings ? structuredClone(savedSettings) : null);
    resetNavEditorState();
  }

  return {
    busy,
    err,
    nav,
    openNav,
    draftSettings,
    settingsDirty,
    settingsSavedAt: savedAt,
    navDraft,
    navByGroup,
    setDraftSettings,
    saveSettings,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    saveAllNavRows,
    addNavRow,
    sourceVersion,
    saveDrafts,
    discardDrafts,
  };
}
