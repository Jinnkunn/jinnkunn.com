"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseWorkspaceLocation, workspaceUrl, type WorkspaceLocation } from "./site-admin-workspace-location";

function writeWorkspaceHistory(method: "pushState" | "replaceState", url: string, position: number) {
  // Only query state changes here; this route does not read Next search params.
  // Bypass Next's asynchronous URL restore so it cannot overwrite a newer pop.
  const state = { ...window.history.state, workspaceIndex: position };
  window.History.prototype[method].call(window.history, state, "", url);
}

export function useSiteAdminWorkspaceLocation({ actor, ready, location, onRestore }: {
  actor: string; ready: boolean; location: WorkspaceLocation; onRestore: (next: WorkspaceLocation) => Promise<boolean>;
}) {
  const callback = useRef(onRestore);
  const readyRef = useRef(ready);
  const restoring = useRef(false);
  const restorationUrl = useRef("");
  const index = useRef(0);
  const sequence = useRef(0);
  const positions = useRef(new Map<string, number>());
  const lastUrl = useRef("");
  const [hydrated, setHydrated] = useState(false);
  const url = workspaceUrl(location);
  const key = `site-admin:workspace:${actor}`;
  const rememberPosition = useCallback((value: string, position: number) => {
    positions.current.delete(value);
    positions.current.set(value, position);
    if (positions.current.size > 100) positions.current.delete(positions.current.keys().next().value!);
    try { sessionStorage.setItem(`${key}:positions`, JSON.stringify([...positions.current])); } catch { /* Optional preference. */ }
  }, [key]);
  useLayoutEffect(() => { callback.current = onRestore; readyRef.current = ready; });
  useEffect(() => {
    if (!ready || restoring.current) return;
    let cancelled = false;
    restoring.current = true;
    const request = ++sequence.current;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`${key}:positions`) || "[]");
      if (Array.isArray(saved)) for (const entry of saved.slice(-100)) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && Number.isSafeInteger(entry[1]) && workspaceUrl(parseWorkspaceLocation(entry[0])) === entry[0]) positions.current.set(entry[0], entry[1]);
      }
    } catch { /* Corrupt preferences cannot block navigation. */ }
    const savedIndex = window.history.state?.workspaceIndex;
    index.current = Number.isInteger(savedIndex) ? savedIndex : positions.current.get(workspaceUrl(parseWorkspaceLocation(window.location.href))) ?? 0;
    let initial = window.location.href;
    if (!window.location.search) {
      try { initial = sessionStorage.getItem(key) || initial; } catch { /* Optional preference. */ }
    }
    const next = parseWorkspaceLocation(initial);
    restorationUrl.current = workspaceUrl(next);
    void callback.current(next).then((accepted) => {
      if (!cancelled && request === sequence.current) {
        if (!accepted) restoring.current = false;
        setHydrated(true);
      }
    }).catch(() => {
      if (!cancelled && request === sequence.current) { restoring.current = false; setHydrated(true); }
    });
    return () => { cancelled = true; };
  }, [ready, key]);
  // A restored view must not paint before its history bookkeeping commits;
  // Back/Forward can arrive as soon as its controls are visible.
  useLayoutEffect(() => {
    if (!hydrated) return;
    if (restoring.current) {
      // State setters inside onRestore may commit after its promise resolves.
      if (url === restorationUrl.current) {
        if (!lastUrl.current) {
          writeWorkspaceHistory("replaceState", url, index.current);
          try { sessionStorage.setItem(key, url); } catch { /* Optional preference. */ }
        }
        restoring.current = false;
        lastUrl.current = url;
        rememberPosition(url, index.current);
      }
      return;
    }
    if (url === lastUrl.current) return;
    const first = !lastUrl.current;
    if (!first) index.current += 1;
    writeWorkspaceHistory(first ? "replaceState" : "pushState", url, index.current);
    lastUrl.current = url;
    rememberPosition(url, index.current);
    try { sessionStorage.setItem(key, url); } catch { /* Optional preference. */ }
  }, [hydrated, url, key, rememberPosition]);
  useLayoutEffect(() => {
    let reverting = false;
    let active = true;
    const restore = async (event: PopStateEvent) => {
      if (window.location.pathname !== "/site-admin") return;
      // Workspace entries restore client state, not a cached server-rendered route.
      event.stopImmediatePropagation();
      // A pop during bootstrap is restored from the current URL when data is
      // ready. Do not let Next restore a stale cached console in the meantime.
      if (!readyRef.current) return;
      if (reverting) { reverting = false; restoring.current = false; return; }
      restoring.current = true;
      const request = ++sequence.current;
      const next = parseWorkspaceLocation(window.location.href);
      const targetUrl = workspaceUrl(next);
      // Next may replace its current entry without retaining custom state.
      // The URL still identifies a workspace location and must be restored.
      const target = Number.isInteger(event.state?.workspaceIndex)
        ? event.state.workspaceIndex
        : positions.current.get(targetUrl) ?? index.current - 1;
      const unchanged = targetUrl === lastUrl.current;
      restorationUrl.current = targetUrl;
      const accepted = await callback.current(next);
      if (!active || request !== sequence.current) return;
      if (!accepted) {
        reverting = true;
        window.history.go(index.current - target || 1);
        return;
      }
      index.current = target;
      lastUrl.current = targetUrl;
      rememberPosition(targetUrl, target);
      writeWorkspaceHistory("replaceState", targetUrl, target);
      try { sessionStorage.setItem(key, lastUrl.current); } catch { /* Optional preference. */ }
      if (unchanged) restoring.current = false;
      setHydrated(true);
    };
    window.addEventListener("popstate", restore, true);
    return () => { active = false; window.removeEventListener("popstate", restore, true); };
  }, [key, rememberPosition]);
  return hydrated;
}
