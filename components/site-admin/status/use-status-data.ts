"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { StatusResult } from "@/components/site-admin/status/types";
import { siteAdminBackend } from "@/lib/client/site-admin-backend";
import type { SiteAdminDeployResult } from "@/lib/site-admin/api-types";
import { triggerSiteAdminDeploy } from "@/lib/client/site-admin-deploy";
import { isSiteAdminStatusOk } from "@/lib/site-admin/status-contract";
import {
  deriveSiteAdminStatus,
  type BannerState,
  type GeneratedState,
  type ReadinessState,
  type StatusFreshness,
} from "@/lib/site-admin/status-model";

export type { BannerState, GeneratedState, ReadinessState, StatusFreshness };

export function useSiteAdminStatusData() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<StatusResult | null>(null);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployRes, setDeployRes] = useState<SiteAdminDeployResult | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await siteAdminBackend.getStatus();
      setRes(data);
    } catch (e) {
      setRes({
        ok: false,
        error: e instanceof Error ? e.message : "Request failed",
        code: "REQUEST_FAILED",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const deploy = useCallback(async () => {
    if (deployBusy) return;
    setDeployBusy(true);
    setDeployRes(null);
    const out = await triggerSiteAdminDeploy();
    setDeployRes(out);
    setDeployBusy(false);
    if (out.ok) {
      void load();
    }
  }, [deployBusy, load]);

  const payload = res && isSiteAdminStatusOk(res) ? res : null;
  const derived = useMemo(() => deriveSiteAdminStatus(payload), [payload]);

  return {
    busy,
    res,
    payload,
    deploymentLink: derived.deploymentLink,
    stale: derived.stale,
    generated: derived.generated,
    readiness: derived.readiness,
    banner: derived.banner,
    load,
    deployBusy,
    deployRes,
    deploy,
  };
}
