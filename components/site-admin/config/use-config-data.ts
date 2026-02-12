"use client";

import { useEffect, useMemo, useState } from "react";

import type { NavItemRow, SiteSettings } from "@/components/site-admin/config/types";
import {
  asApiGet,
  asApiPost,
} from "@/components/site-admin/config/utils";
import { asApiAck, isApiOk } from "@/lib/client/api-guards";
import { requestJsonOrThrow } from "@/lib/client/request-json";
import type { ApiGet, ApiPost } from "@/components/site-admin/config/types";

function errorFromUnknown(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isApiGetOk(v: ApiGet): v is Extract<ApiGet, { ok: true }> {
  return v.ok;
}

function isApiPostOk(v: ApiPost): v is Extract<ApiPost, { ok: true }> {
  return v.ok;
}

export function useSiteAdminConfigData() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nav, setNav] = useState<NavItemRow[]>([]);
  const [openNav, setOpenNav] = useState<Record<string, boolean>>({});
  const [draftSettings, setDraftSettings] = useState<SiteSettings | null>(null);
  const [navDraft, setNavDraft] = useState<Record<string, Partial<NavItemRow>>>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setErr("");
      try {
        const data = await requestJsonOrThrow(
          "/api/site-admin/config",
          { cache: "no-store" },
          asApiGet,
          { isOk: isApiGetOk },
        );
        if (!cancelled) {
          setDraftSettings(data.settings ? { ...data.settings } : null);
          setNav(data.nav || []);
          setNavDraft({});
          setOpenNav({});
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(errorFromUnknown(e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const navByGroup = useMemo(() => {
    const top = nav.filter((x) => x.group === "top");
    const more = nav.filter((x) => x.group === "more");
    return { top, more };
  }, [nav]);

  const saveSettings = async () => {
    if (!draftSettings?.rowId) return;
    setBusy(true);
    setErr("");
    try {
      const patch: Record<string, unknown> = {
        siteName: draftSettings.siteName,
        lang: draftSettings.lang,
        seoTitle: draftSettings.seoTitle,
        seoDescription: draftSettings.seoDescription,
        favicon: draftSettings.favicon,
        googleAnalyticsId: draftSettings.googleAnalyticsId,
        contentGithubUsers: draftSettings.contentGithubUsers,
        rootPageId: draftSettings.rootPageId,
        homePageId: draftSettings.homePageId,
      };
      await requestJsonOrThrow(
        "/api/site-admin/config",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "settings", rowId: draftSettings.rowId, patch }),
        },
        asApiAck,
        { isOk: isApiOk },
      );
    } catch (e: unknown) {
      setErr(errorFromUnknown(e));
    } finally {
      setBusy(false);
    }
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
        asApiAck,
        { isOk: isApiOk },
      );

      setNav((prev) => prev.map((it) => (it.rowId === row.rowId ? { ...it, ...patch } : it)));
      setNavDraft((prev) => {
        const next = { ...prev };
        delete next[row.rowId];
        return next;
      });
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
