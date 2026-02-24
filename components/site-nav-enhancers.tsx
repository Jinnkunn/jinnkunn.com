"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function SiteNavEnhancers() {
  const pathname = usePathname();

  useEffect(() => {
    let closed = false;
    void (async () => {
      const [{ setupSiteNavBehavior }, { setupSearchBehavior }] = await Promise.all([
        import("@/lib/client/nav/behavior-runtime"),
        import("@/lib/client/search/behavior-runtime"),
      ]);
      if (closed) return;
      setupSiteNavBehavior();
      setupSearchBehavior();
    })();
    return () => {
      closed = true;
    };
  }, []);

  useEffect(() => {
    let closed = false;
    void (async () => {
      const [{ refreshSiteNavActiveLinks }, { closeOpenSearchOverlay }] = await Promise.all([
        import("@/lib/client/nav/behavior-runtime"),
        import("@/lib/client/search/behavior-runtime"),
      ]);
      if (closed) return;
      refreshSiteNavActiveLinks();
      closeOpenSearchOverlay();
    })();
    return () => {
      closed = true;
    };
  }, [pathname]);

  return null;
}
