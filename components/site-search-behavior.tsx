"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { closeOpenSearchOverlay, setupSearchBehavior } from "@/lib/client/search/behavior-runtime";

export default function SiteSearchBehavior() {
  const pathname = usePathname();

  useEffect(() => setupSearchBehavior(), []);

  useEffect(() => {
    closeOpenSearchOverlay();
  }, [pathname]);

  return null;
}
