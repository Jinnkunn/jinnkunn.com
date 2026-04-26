import { useCallback, useEffect, useRef, useState } from "react";

import { prepareHomeDataForSave } from "./schema";
import type { HomeData } from "../types";
import type { NormalizedApiResponse } from "../types";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

export function useHomePreview({
  draft,
  onSelectSection,
  ready,
  request,
  selectedSectionId,
}: {
  draft: HomeData;
  onSelectSection: (id: string) => void;
  ready: boolean;
  request: RequestFn;
  selectedSectionId: string;
}) {
  const [html, setHtml] = useState("");
  const [stylesheets, setStylesheets] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/preview/home", "POST", {
        data: prepareHomeDataForSave(draft),
      });
      setLoading(false);
      if (!response.ok) {
        setHtml("");
        setStylesheets([]);
        setError(`${response.code}: ${response.error}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      setHtml(typeof data.html === "string" ? data.html : "");
      setStylesheets(
        Array.isArray(data.stylesheets)
          ? data.stylesheets.filter((href): href is string => typeof href === "string")
          : [],
      );
    }, 650);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [draft, ready, request]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== "site-admin:home-section-select") return;
      const id = typeof data.id === "string" ? data.id : "";
      if (draft.sections.some((section) => section.id === id)) {
        onSelectSection(id);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [draft.sections, onSelectSection]);

  const postHighlight = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "site-admin:home-section-highlight", id: selectedSectionId },
      "*",
    );
  }, [selectedSectionId]);

  useEffect(() => {
    postHighlight();
  }, [html, postHighlight]);

  return {
    error,
    frameRef,
    html,
    loading,
    onFrameLoad: postHighlight,
    stylesheets,
  };
}
