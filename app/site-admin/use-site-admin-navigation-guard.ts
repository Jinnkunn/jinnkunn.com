"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type GuardInput = { dirty: boolean; saving: boolean; save: () => Promise<boolean>; discard: () => void; error?: string };
type Prompt = { phase: "choice" | "waiting" | "saving"; error: string };

export function useSiteAdminNavigationGuard(input: GuardInput) {
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const idleWaiters = useRef<(() => void)[]>([]);
  const mounted = useRef(true);
  const saveInFlight = useRef(false);
  useEffect(() => {
    if (!input.saving) idleWaiters.current.splice(0).forEach((resolve) => resolve());
  }, [input.saving]);
  useEffect(() => { mounted.current = true; const waiters = idleWaiters.current; return () => {
    mounted.current = false; pending.current?.(false); pending.current = null;
    waiters.splice(0).forEach((resolve) => resolve());
  }; }, []);
  const finish = useCallback((accepted: boolean) => {
    const resolve = pending.current; pending.current = null;
    if (mounted.current) setPrompt(null);
    resolve?.(accepted);
  }, []);
  const authorize = useCallback((): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    if (!latest.current.dirty && !latest.current.saving) return Promise.resolve(true);
    return new Promise((resolve) => {
      pending.current = resolve;
      setPrompt({ phase: latest.current.saving ? "waiting" : "choice", error: "" });
      if (latest.current.saving) {
        void new Promise<void>((idle) => idleWaiters.current.push(idle)).then(() => {
          if (pending.current !== resolve || !mounted.current) return;
          if (latest.current.dirty) setPrompt({ phase: "choice", error: "" });
          else finish(true);
        });
      }
    });
  }, [finish]);
  const saveAndContinue = async () => {
    if (!pending.current || latest.current.saving || saveInFlight.current) return;
    if (!latest.current.dirty) { finish(true); return; }
    setPrompt({ phase: "saving", error: "" });
    saveInFlight.current = true;
    try {
      const saved = await latest.current.save();
      // Saved baselines are React state; wait for their commit before leaving.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!mounted.current || !pending.current) return;
      if (!saved) setPrompt({ phase: "choice", error: latest.current.error || "The draft could not be saved. Your edits are still here." });
      else if (latest.current.dirty) setPrompt({ phase: "choice", error: "Newer edits still need saving. Review them before continuing." });
      else finish(true);
    } catch (error) {
      if (mounted.current) setPrompt({ phase: "choice", error: error instanceof Error ? error.message : String(error) });
    } finally { saveInFlight.current = false; }
  };
  const discardAndContinue = () => {
    if (latest.current.saving || saveInFlight.current) return;
    latest.current.discard(); finish(true);
  };
  return { prompt, pending: Boolean(prompt), authorize, saveAndContinue, discardAndContinue, stay: () => finish(false) };
}
export type SiteAdminNavigationGuard = ReturnType<typeof useSiteAdminNavigationGuard>;
export type SiteAdminNavigationActions = { save: () => Promise<boolean>; discard: () => void };
