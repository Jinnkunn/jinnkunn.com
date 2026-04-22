"use client";

import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";

import type { NavItemRow } from "./types";
import { errorFromUnknown } from "./utils";
import { isRequestJsonError, requestJsonOrThrow } from "@/lib/client/request-json";
import type { SiteAdminSourceVersion } from "@/lib/site-admin/api-types";
import { isSiteAdminConfigPostOk, parseSiteAdminConfigPost } from "@/lib/site-admin/config-contract";
import type { SiteAdminEditorResultState } from "@/lib/site-admin/editor-state";
import { mapEditorErrorToResult } from "@/lib/site-admin/editor-state";

type UseSiteAdminNavMutationsArgs = {
  setBusy: (value: boolean) => void;
  setNav: Dispatch<SetStateAction<NavItemRow[]>>;
  sourceVersion: SiteAdminSourceVersion | null;
  setSourceVersion: Dispatch<SetStateAction<SiteAdminSourceVersion | null>>;
  setEditorResult: Dispatch<SetStateAction<SiteAdminEditorResultState>>;
  clearEditorResultOnEdit: () => void;
  conflictLocked: boolean;
};

export function useSiteAdminNavMutations({
  setBusy,
  setNav,
  sourceVersion,
  setSourceVersion,
  setEditorResult,
  clearEditorResultOnEdit,
  conflictLocked,
}: UseSiteAdminNavMutationsArgs) {
  const [openNav, setOpenNav] = useState<Record<string, boolean>>({});
  const [navDraft, setNavDraft] = useState<Record<string, Partial<NavItemRow>>>({});

  const resetNavEditorState = () => {
    setNavDraft({});
    setOpenNav({});
  };

  const updateNavDraftField = (rowId: string, patch: Partial<NavItemRow>) => {
    clearEditorResultOnEdit();
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
    if (conflictLocked) return;
    setBusy(true);
    setEditorResult({
      kind: "saving",
      message: "Saving navigation changes to GitHub main...",
    });
    try {
      const patch = navDraft[row.rowId] || {};
      const result = await requestJsonOrThrow(
        "/api/site-admin/config",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "nav-update",
            rowId: row.rowId,
            expectedSiteConfigSha: sourceVersion?.siteConfigSha || "",
            patch,
          }),
        },
        parseSiteAdminConfigPost,
        { isOk: isSiteAdminConfigPostOk },
      );

      setNav((prev) => prev.map((it) => (it.rowId === row.rowId ? { ...it, ...patch } : it)));
      setSourceVersion(result.sourceVersion);
      clearNavDraft(row.rowId);
      setEditorResult({
        kind: "saved",
        message: "Navigation saved to GitHub main. Deploy from Site Admin when ready.",
      });
    } catch (e: unknown) {
      setEditorResult(
        mapEditorErrorToResult({
          code: isRequestJsonError(e) ? e.code : "",
          message: errorFromUnknown(e),
          conflictMessage: "Source changed on GitHub. Reload latest before saving again.",
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const addNavRow = async (group: "top" | "more") => {
    if (conflictLocked) return;
    setBusy(true);
    setEditorResult({
      kind: "saving",
      message: "Adding navigation item to GitHub main...",
    });
    try {
      const data = await requestJsonOrThrow(
        "/api/site-admin/config",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "nav-create",
            expectedSiteConfigSha: sourceVersion?.siteConfigSha || "",
            input: {
              label: "New item",
              href: "/new",
              group,
              order: 999,
              enabled: true,
            },
          }),
        },
        parseSiteAdminConfigPost,
        { isOk: isSiteAdminConfigPostOk },
      );
      const created = data.created || null;
      setSourceVersion(data.sourceVersion);
      if (created?.rowId) {
        setNav((prev) => [...prev, created].sort((a, b) => a.order - b.order));
        setOpenNav((prev) => ({ ...prev, [created.rowId]: true }));
      }
      setEditorResult({
        kind: "saved",
        message: "Navigation item saved to GitHub main. Deploy from Site Admin when ready.",
      });
    } catch (e: unknown) {
      setEditorResult(
        mapEditorErrorToResult({
          code: isRequestJsonError(e) ? e.code : "",
          message: errorFromUnknown(e),
          conflictMessage: "Source changed on GitHub. Reload latest before saving again.",
        }),
      );
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
