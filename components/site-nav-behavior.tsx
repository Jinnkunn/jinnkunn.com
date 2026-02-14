"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import {
  refreshSiteNavActiveLinks,
  setupSiteNavBehavior,
} from "@/lib/client/nav/behavior-runtime";

export default function SiteNavBehavior() {
  const pathname = usePathname();

  useEffect(() => setupSiteNavBehavior(), []);

  useEffect(() => {
    refreshSiteNavActiveLinks();
  }, [pathname]);

  return null;
}
