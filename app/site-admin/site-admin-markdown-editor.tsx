"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "./site-admin-dashboard.module.css";

const SiteAdminSourceEditor = dynamic(
  () =>
    import("./site-admin-source-editor").then((module) => module.SiteAdminSourceEditor),
  {
    ssr: false,
    loading: () => <div className={styles.editorLoading}>Opening source editor…</div>,
  },
);

const SiteAdminVisualEditor = dynamic(
  () =>
    import("./site-admin-visual-editor").then((module) => module.SiteAdminVisualEditor),
  {
    ssr: false,
    loading: () => <div className={styles.editorLoading}>Opening editor…</div>,
  },
);

type MarkdownEditorSize = "regular" | "compact" | "large";
type MarkdownPreviewLayout = "tabs" | "split";
type EditorMode = "visual" | "source" | "preview";

type MarkdownEditorProps = {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  minHeight?: number;
  placeholder?: string;
  size?: MarkdownEditorSize;
  disabled?: boolean;
  previewLayout?: MarkdownPreviewLayout;
  allowImageUpload?: boolean;
  initialMode?: EditorMode;
  visualEditing?: boolean;
  onEditComponent?: (component: string) => void;
};

function editorStats(value: string) {
  const words = value
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_>#\[\](){}|-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const components = value.match(/<([A-Z][A-Za-z0-9.]*)\b/g)?.length || 0;
  return { words, components };
}

export function SiteAdminMarkdownEditor({
  label = "MDX editor",
  value,
  onChange,
  minHeight = 420,
  placeholder,
  size = "regular",
  disabled = false,
  previewLayout = "tabs",
  allowImageUpload = true,
  initialMode = "visual",
  visualEditing = true,
  onEditComponent,
}: MarkdownEditorProps) {
  const previewRequestIdRef = useRef(0);
  const [mode, setMode] = useState<EditorMode>(
    visualEditing ? initialMode : initialMode === "preview" ? "preview" : "source",
  );
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [visualError, setVisualError] = useState("");
  const stats = useMemo(() => editorStats(value), [value]);
  const isSplitPreview = previewLayout === "split";

  const renderPreview = useCallback(async () => {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const response = await fetch("/api/site-admin/preview/mdx", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ source: value }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `${response.status} ${response.statusText}`);
      }
      if (previewRequestIdRef.current !== requestId) return;
      setPreviewHtml(String(payload?.data?.html || payload?.html || ""));
    } catch (error: unknown) {
      if (previewRequestIdRef.current !== requestId) return;
      setPreviewHtml("");
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      if (previewRequestIdRef.current === requestId) setPreviewLoading(false);
    }
  }, [value]);

  useEffect(() => {
    if (mode !== "preview" && !isSplitPreview) return;
    const timer = window.setTimeout(() => void renderPreview(), 260);
    return () => window.clearTimeout(timer);
  }, [isSplitPreview, mode, renderPreview]);

  function changeMode(nextMode: EditorMode) {
    setMode(nextMode);
    if (nextMode === "preview") void renderPreview();
  }

  function renderPreviewPane() {
    return (
      <div className={styles.markdownPreviewShell} style={{ minHeight }}>
        {previewLoading ? (
          <p className={styles.previewEmpty}>Rendering preview…</p>
        ) : previewError ? (
          <div className={styles.previewError} role="alert">
            <strong>Preview unavailable</strong>
            <span>{previewError}</span>
          </div>
        ) : previewHtml.trim() ? (
          <div
            className={styles.markdownPreview}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <p className={styles.previewEmpty}>Nothing to preview yet.</p>
        )}
      </div>
    );
  }

  const sourceEditor = (
    <SiteAdminSourceEditor
      label={label}
      value={value}
      onChange={onChange}
      minHeight={minHeight}
      placeholder={placeholder}
      disabled={disabled}
      allowImageUpload={allowImageUpload}
    />
  );

  return (
    <div className={styles.markdownEditor} data-size={size} data-layout={previewLayout}>
      <div className={styles.editorModeBar}>
        <div className={styles.editorModeTabs} role="tablist" aria-label={`${label} view`}>
          {visualEditing ? (
            <button
              type="button"
              className={styles.markdownModeButton}
              data-active={mode === "visual"}
              onClick={() => changeMode("visual")}
              role="tab"
              aria-selected={mode === "visual"}
            >
              Write
            </button>
          ) : null}
          <button
            type="button"
            className={styles.markdownModeButton}
            data-active={mode === "source"}
            onClick={() => changeMode("source")}
            role="tab"
            aria-selected={mode === "source"}
          >
            Source
          </button>
          <button
            type="button"
            className={styles.markdownModeButton}
            data-active={mode === "preview"}
            onClick={() => changeMode("preview")}
            role="tab"
            aria-selected={mode === "preview"}
          >
            Preview
          </button>
        </div>
        <div className={styles.editorModeMeta}>
          {mode === "visual" ? <span>Type / for blocks</span> : null}
          <span>{stats.words} words</span>
          {stats.components > 0 ? <span>{stats.components} components</span> : null}
        </div>
      </div>

      {visualError ? (
        <div className={styles.editorModeNotice} role="status">
          <span>This document includes MDX that needs Source mode.</span>
          <button type="button" onClick={() => changeMode("source")}>
            Open Source
          </button>
        </div>
      ) : null}

      {isSplitPreview ? (
        <div className={styles.markdownSplit}>
          {sourceEditor}
          {renderPreviewPane()}
        </div>
      ) : mode === "visual" && visualEditing ? (
        <SiteAdminVisualEditor
          label={label}
          value={value}
          onChange={onChange}
          minHeight={minHeight}
          placeholder={placeholder}
          disabled={disabled}
          allowImageUpload={allowImageUpload}
          onEditComponent={onEditComponent}
          onVisualError={(message) => {
            setVisualError(message);
            setMode("source");
          }}
        />
      ) : mode === "source" ? (
        sourceEditor
      ) : (
        renderPreviewPane()
      )}
    </div>
  );
}
