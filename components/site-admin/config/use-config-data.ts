"use client";

import { useEffect, useMemo, useState } from "react";

import type { NavItemRow, SiteSettings } from "@/components/site-admin/config/types";
import { errorFromUnknown } from "@/components/site-admin/config/utils";
import { useSiteAdminNavMutations } from "@/components/site-admin/config/use-nav-mutations";
import { useSiteAdminSettingsMutation } from "@/components/site-admin/config/use-settings-mutation";
import { requestJsonOrThrow } from "@/lib/client/request-json";
import { isSiteAdminConfigGetOk, parseSiteAdminConfigGet } from "@/lib/site-admin/config-contract";

export function useSiteAdminConfigData() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nav, setNav] = useState<NavItemRow[]>([]);
  const [draftSettings, setDraftSettings] = useState<SiteSettings | null>(null);
  const {
    openNav,
    navDraft,
    resetNavEditorState,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    addNavRow,
  } = useSiteAdminNavMutations({ setBusy, setErr, setNav });
  const saveSettings = useSiteAdminSettingsMutation({ draftSettings, setBusy, setErr });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setErr("");
      try {
        const data = await requestJsonOrThrow(
          "/api/site-admin/config",
          { cache: "no-store" },
          parseSiteAdminConfigGet,
          { isOk: isSiteAdminConfigGetOk },
        );
        if (!cancelled) {
          setDraftSettings(data.settings ? { ...data.settings } : null);
          setNav(data.nav || []);
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

  return {
    busy,
    err,
    nav,
    openNav,
    draftSettings,
    navDraft,
    navByGroup,
    setDraftSettings,
    saveSettings,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    addNavRow,
  };
}
