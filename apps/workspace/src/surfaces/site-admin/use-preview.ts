import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedApiResponse } from "./types";

type RequestFn = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

export interface PreviewState {
  html: string;
  loading: boolean;
  error: string;
}

/**
 * Debounces MDX preview compilation against /api/site-admin/preview. The caller
 * owns the MDX source; we return `{ html, loading, error }` plus a manual
 * `refresh()` trigger.
 */
export function usePreview(
  source: string,
  enabled: boolean,
  request: RequestFn,
  debounceMs = 500,
): PreviewState & { refresh: () => void } {
  const [state, setState] = useState<PreviewState>({
    html: "",
    loading: false,
    error: "",
  });
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<RequestFn>(request);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const runPreview = useCallback(async (mdx: string) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    const response = await requestRef.current("/api/site-admin/preview", "POST", {
      source: mdx,
    });
    if (controller.signal.aborted) return;
    if (!response.ok) {
      setState({
        html: "",
        loading: false,
        error: `${response.code}: ${response.error}`,
      });
      return;
    }
    const data = response.data as Record<string, unknown>;
    const html = typeof data.html === "string" ? data.html : "";
    setState({ html, loading: false, error: "" });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void runPreview(source);
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [debounceMs, enabled, runPreview, source]);

  useEffect(() => {
    if (!enabled && abortRef.current) {
      abortRef.current.abort();
    }
  }, [enabled]);

  const refresh = useCallback(() => {
    void runPreview(source);
  }, [runPreview, source]);

  return { ...state, refresh };
}
