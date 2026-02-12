"use client";

import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";

import type { NavItemRow } from "./types";
import { asApiPost, errorFromUnknown, isApiPostOk } from "./utils";
import { requestJsonOrThrow } from "@/lib/client/request-json";

type UseSiteAdminNavMutationsArgs = {
  setBusy: (value: boolean) => void;
  setErr: (value: string) => void;
  setNav: Dispatch<SetStateAction<NavItemRow[]>>;
};

export function useSiteAdminNavMutations({ setBusy, setErr, setNav }: UseSiteAdminNavMutationsArgs) {
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
    setBusy(true);
    setErr("");
    try {
      const patch = navDraft[row.rowId] || {};
      await requestJsonOrThrow(
        "/api/site-admin/config",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "nav-update", rowId: row.rowId, patch }),
        },
        asApiPost,
        { isOk: isApiPostOk },
      );

      setNav((prev) => prev.map((it) => (it.rowId === row.rowId ? { ...it, ...patch } : it)));
      clearNavDraft(row.rowId);
    } catch (e: unknown) {
      setErr(errorFromUnknown(e));
    } finally {
      setBusy(false);
    }
  };

  const addNavRow = async (group: "top" | "more") => {
    setBusy(true);
    setErr("");
    try {
      const data = await requestJsonOrThrow(
        "/api/site-admin/config",
        {
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
        },
        asApiPost,
        { isOk: isApiPostOk },
      );
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
