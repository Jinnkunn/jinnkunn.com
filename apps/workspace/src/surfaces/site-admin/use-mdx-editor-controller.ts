import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

import type { MarkdownEditorApi } from "./MarkdownEditor";
import { insertMarkdownImage, uploadImageFile } from "./assets-upload";
import { rememberRecentAsset } from "./AssetLibraryPicker";
import type { NormalizedApiResponse } from "./types";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

type SetMessageFn = (kind: "error" | "success", text: string) => void;

export interface UseMdxEditorControllerOptions {
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: SetMessageFn;
}

export function useUnsavedChangesBeforeUnload(
  dirty: boolean,
  saving: boolean,
  deleting: boolean,
) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saving || deleting) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [deleting, dirty, saving]);
}

export function useConfirmingBack({
  dirty,
  initialSlug,
  onExit,
  source,
}: {
  dirty: boolean;
  initialSlug?: string;
  onExit: (action: "cancel", slug?: string) => void;
  source: string;
}) {
  const [confirmBackSource, setConfirmBackSource] = useState("");
  const confirmBack = dirty && confirmBackSource === source;

  useEffect(() => {
    if (dirty) return;
    const resetTimer = window.setTimeout(() => setConfirmBackSource(""), 0);
    return () => window.clearTimeout(resetTimer);
  }, [dirty]);

  const leaveEditor = useCallback(() => {
    if (dirty && !confirmBack) {
      setConfirmBackSource(source);
      return;
    }
    onExit("cancel", initialSlug);
  }, [confirmBack, dirty, initialSlug, onExit, source]);

  return { confirmBack, leaveEditor };
}

export function useMdxImageUploadDrop({
  request,
  setError,
  setMessage,
}: UseMdxEditorControllerOptions) {
  const [dragDepth, setDragDepth] = useState(0);
  const [uploading, setUploading] = useState(false);
  const editorApiRef = useRef<MarkdownEditorApi | null>(null);

  const onEditorReady = useCallback((api: MarkdownEditorApi) => {
    editorApiRef.current = api;
  }, []);

  const insertAssetImage = useCallback((url: string, alt: string) => {
    const api = editorApiRef.current;
    if (!api) return false;
    insertMarkdownImage(api, url, alt.replace(/\.[^.]+$/, ""));
    return true;
  }, []);

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragDepth((depth) => depth + 1);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragDepth((depth) => Math.max(0, depth - 1));
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragDepth(0);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0 || !editorApiRef.current) return;
      for (const file of files) {
        setUploading(true);
        const result = await uploadImageFile({ file, request });
        setUploading(false);
        if (!result.ok) {
          setError(result.error);
          setMessage("error", `Upload failed: ${result.error}`);
          continue;
        }
        rememberRecentAsset(result.asset, result.filename);
        insertAssetImage(result.asset.url, file.name || result.filename);
        setMessage("success", `Uploaded ${result.filename} → ${result.asset.url}`);
      }
    },
    [insertAssetImage, request, setError, setMessage],
  );

  return useMemo(
    () => ({
      dragDepth,
      handleDrop,
      insertAssetImage,
      onDragEnter,
      onDragLeave,
      onEditorReady,
      uploading,
    }),
    [
      dragDepth,
      handleDrop,
      insertAssetImage,
      onDragEnter,
      onDragLeave,
      onEditorReady,
      uploading,
    ],
  );
}
