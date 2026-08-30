"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  refreshSiteNavActiveLinks,
  setupSiteNavBehavior,
} from "@/lib/client/nav/behavior-runtime";
import {
  closeOpenSearchOverlay,
  setupSearchBehavior,
} from "@/lib/client/search/behavior-runtime";

export default function SiteNavEnhancers() {
  const pathname = usePathname();

  useEffect(() => {
    const cleanupNav = setupSiteNavBehavior();
    const cleanupSearch = setupSearchBehavior();

    return () => {
      cleanupSearch?.();
      cleanupNav();
    };
  }, []);

  useEffect(() => {
    refreshSiteNavActiveLinks();
    closeOpenSearchOverlay();
  }, [pathname]);

  return null;
}
