"use client";
import { useEffect, useRef, useState } from "react";
import { parseWorkspaceLocation, workspaceUrl, type WorkspaceLocation } from "./site-admin-workspace-location";

export function useSiteAdminWorkspaceLocation({ actor, ready, location, onRestore }: {
  actor: string; ready: boolean; location: WorkspaceLocation; onRestore: (next: WorkspaceLocation) => Promise<boolean>;
}) {
  const callback = useRef(onRestore);
  const restoring = useRef(false);
  const restorationUrl = useRef("");
  const index = useRef(0);
  const lastUrl = useRef("");
  const [hydrated, setHydrated] = useState(false);
  const url = workspaceUrl(location);
  const key = `site-admin:workspace:${actor}`;
  useEffect(() => { callback.current = onRestore; });
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    restoring.current = true;
    const savedIndex = window.history.state?.workspaceIndex;
    index.current = Number.isInteger(savedIndex) ? savedIndex : 0;
    let initial = window.location.href;
    if (!window.location.search) {
      try { initial = sessionStorage.getItem(key) || initial; } catch { /* Optional preference. */ }
    }
    const next = parseWorkspaceLocation(initial);
    restorationUrl.current = workspaceUrl(next);
    void callback.current(next).then((accepted) => {
      if (!cancelled) {
        if (!accepted) restoring.current = false;
        setHydrated(true);
      }
    }).catch(() => {
      if (!cancelled) { restoring.current = false; setHydrated(true); }
    });
    return () => { cancelled = true; };
  }, [ready, key]);
  useEffect(() => {
    if (!hydrated) return;
    if (restoring.current) {
      // State setters inside onRestore may commit after its promise resolves.
      if (url === restorationUrl.current) {
        if (!lastUrl.current) {
          window.history.replaceState({ workspaceIndex: index.current }, "", url);
          try { sessionStorage.setItem(key, url); } catch { /* Optional preference. */ }
        }
        restoring.current = false;
        lastUrl.current = url;
      }
      return;
    }
    if (url === lastUrl.current) return;
    const first = !lastUrl.current;
    if (!first) index.current += 1;
    // Let Next attach its own router state; copying __NA bypasses its URL sync.
    window.history[first ? "replaceState" : "pushState"]({ workspaceIndex: index.current }, "", url);
    lastUrl.current = url;
    try { sessionStorage.setItem(key, url); } catch { /* Optional preference. */ }
  }, [hydrated, url, key]);
  useEffect(() => {
    if (!hydrated) return;
    let reverting = false;
    let sequence = 0;
    const restore = async (event: PopStateEvent) => {
      if (!Number.isInteger(event.state?.workspaceIndex) || window.location.pathname !== "/site-admin") return;
      // Workspace entries restore client state, not a cached server-rendered route.
      event.stopImmediatePropagation();
      if (reverting) { reverting = false; restoring.current = false; return; }
      restoring.current = true;
      const request = ++sequence;
      const target = typeof event.state?.workspaceIndex === "number" ? event.state.workspaceIndex : index.current - 1;
      const next = parseWorkspaceLocation(window.location.href);
      const targetUrl = workspaceUrl(next);
      const unchanged = targetUrl === lastUrl.current;
      restorationUrl.current = targetUrl;
      const accepted = await callback.current(next);
      if (request !== sequence) return;
      if (!accepted) {
        reverting = true;
        window.history.go(index.current - target || 1);
        return;
      }
      index.current = target;
      lastUrl.current = targetUrl;
      window.history.replaceState({ workspaceIndex: target }, "", targetUrl);
      try { sessionStorage.setItem(key, lastUrl.current); } catch { /* Optional preference. */ }
      if (unchanged) restoring.current = false;
    };
    window.addEventListener("popstate", restore, true);
    return () => window.removeEventListener("popstate", restore, true);
  }, [hydrated, key]);
  return hydrated;
}
