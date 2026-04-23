"use client";

import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";

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

  const resetNavEditorState = () => {
    setNavDraft({});
    setOpenNav({});
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
