"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";

import type { NavItemRow } from "./types";
import { errorFromUnknown } from "./utils";
import { siteAdminBackend } from "@/lib/client/site-admin-backend";
import type { SiteAdminConfigSourceVersion } from "@/lib/site-admin/api-types";

type UseSiteAdminNavMutationsArgs = {
  setBusy: (value: boolean) => void;
  setErr: (value: string) => void;
  setNav: Dispatch<SetStateAction<NavItemRow[]>>;
  sourceVersion: SiteAdminConfigSourceVersion | null;
  setSourceVersion: (value: SiteAdminConfigSourceVersion) => void;
};

export function useSiteAdminNavMutations({
  setBusy,
  setErr,
  setNav,
  sourceVersion,
  setSourceVersion,
}: UseSiteAdminNavMutationsArgs) {
  const [openNav, setOpenNav] = useState<Record<string, boolean>>({});
  const [navDraft, setNavDraft] = useState<Record<string, Partial<NavItemRow>>>({});

  // useCallback so use-config-data.ts can safely depend on this in its
  // mount-time useEffect without re-firing the fetch every render. Without
  // memoization the inline arrow recreates each render → effect deps shift
  // → getConfig() runs in a tight loop. Latent in github mode (slow GitHub
  // API throttled the loop) but exposed by D1's ~10ms reads, which trip
  // the 60-req/min admin rate limit immediately.
  const resetNavEditorState = useCallback(() => {
    setNavDraft({});
    setOpenNav({});
  }, []);

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
    if (!sourceVersion?.siteConfigSha) {
      setErr("Missing sourceVersion. Reload latest and try again.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const patch = navDraft[row.rowId] || {};
      const data = await siteAdminBackend.postConfig({
        kind: "nav-update",
        rowId: row.rowId,
        patch,
        expectedSiteConfigSha: sourceVersion.siteConfigSha,
      });

      setSourceVersion(data.sourceVersion);
      setNav((prev) => prev.map((it) => (it.rowId === row.rowId ? { ...it, ...patch } : it)));
      clearNavDraft(row.rowId);
    } catch (e: unknown) {
      setErr(errorFromUnknown(e));
    } finally {
      setBusy(false);
    }
  };

  const addNavRow = async (group: "top" | "more") => {
    if (!sourceVersion?.siteConfigSha) {
      setErr("Missing sourceVersion. Reload latest and try again.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const data = await siteAdminBackend.postConfig({
        kind: "nav-create",
        input: {
          label: "New item",
          href: "/new",
          group,
          order: 999,
          enabled: true,
        },
        expectedSiteConfigSha: sourceVersion.siteConfigSha,
      });
      setSourceVersion(data.sourceVersion);
      const created = data.created || null;
      if (created?.rowId) {
        setNav((prev) => [...prev, created].sort((a, b) => a.order - b.order));
        setOpenNav((prev) => ({ ...prev, [created.rowId]: true }));
      }
    } catch (e: unknown) {
      setErr(errorFromUnknown(e));
    } finally {
      setBusy(false);
    }
  };

  return {
    openNav,
    navDraft,
    resetNavEditorState,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    addNavRow,
  };
}
