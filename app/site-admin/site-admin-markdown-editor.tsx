"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  analyzeVisualMdxCompatibility,
  visualCompatibilitySummary,
} from "@/lib/site-admin/mdx-visual-compatibility";
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
  /**
   * Locks the editor for a mutation that replaces the document underneath it
   * (delete, rename, version restore). Autosave must never set this: going
   * read-only mid-keystroke swallows typing and moves the caret.
   */
  blocking?: boolean;
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
  blocking = false,
  previewLayout = "tabs",
  allowImageUpload = true,
  initialMode = "visual",
  visualEditing = true,
  onEditComponent,
}: MarkdownEditorProps) {
  const previewRequestIdRef = useRef(0);
  const readOnly = disabled || blocking;
  const [mode, setMode] = useState<EditorMode>(
    visualEditing ? initialMode : initialMode === "preview" ? "preview" : "source",
  );
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRenderer, setPreviewRenderer] = useState("");
  const [visualError, setVisualError] = useState("");
  const stats = useMemo(() => editorStats(value), [value]);
  const visualCompatibility = useMemo(
    () => analyzeVisualMdxCompatibility(value),
    [value],
  );
  const visualAvailable = visualEditing && visualCompatibility.compatible;
  const activeMode = mode === "visual" && !visualAvailable ? "source" : mode;
  const isSplitPreview = previewLayout === "split";

  const renderPreview = useCallback(async () => {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewRenderer("");
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
      setPreviewRenderer(String(payload?.data?.renderer || payload?.renderer || ""));
    } catch (error: unknown) {
      if (previewRequestIdRef.current !== requestId) return;
      setPreviewHtml("");
      setPreviewRenderer("");
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      if (previewRequestIdRef.current === requestId) setPreviewLoading(false);
    }
  }, [value]);

  useEffect(() => {
    if (activeMode !== "preview" && !isSplitPreview) return;
    const timer = window.setTimeout(() => void renderPreview(), 260);
    return () => window.clearTimeout(timer);
  }, [activeMode, isSplitPreview, renderPreview]);

  useEffect(() => {
    if (mode === "visual" && !visualAvailable) setMode("source");
  }, [mode, visualAvailable]);

  function changeMode(nextMode: EditorMode) {
    if (nextMode === "visual" && !visualAvailable) return;
    setMode(nextMode);
    if (nextMode === "preview") void renderPreview();
  }

  function renderPreviewPane() {
    return (
      <div className={styles.markdownPreviewShell} style={{ minHeight }}>
        {previewRenderer === "static-mdx-preview" ? (
          <div className={styles.editorModeNotice} role="note">
            Approximate preview: complex MDX may differ from the published page.
          </div>
        ) : null}
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
      disabled={readOnly}
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
              data-active={activeMode === "visual"}
              onClick={() => changeMode("visual")}
              disabled={!visualAvailable}
              title={
                visualAvailable
                  ? "Visual Markdown editor"
                  : visualCompatibilitySummary(visualCompatibility)
              }
              role="tab"
              aria-selected={activeMode === "visual"}
            >
              Write
            </button>
          ) : null}
          <button
            type="button"
            className={styles.markdownModeButton}
            data-active={activeMode === "source"}
            onClick={() => changeMode("source")}
            role="tab"
            aria-selected={activeMode === "source"}
          >
            Source
          </button>
          <button
            type="button"
            className={styles.markdownModeButton}
            data-active={activeMode === "preview"}
            onClick={() => changeMode("preview")}
            role="tab"
            aria-selected={activeMode === "preview"}
          >
            Preview
          </button>
        </div>
        <div className={styles.editorModeMeta}>
          {activeMode === "visual" ? <span>Type / for blocks</span> : null}
          {activeMode === "preview" && previewRenderer === "runtime-mdx-preview" ? (
            <span>Published renderer</span>
          ) : null}
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

      {visualEditing && !visualCompatibility.compatible ? (
        <div className={styles.editorModeNotice} role="status">
          <span>
            This page uses advanced layout blocks. Edit the source directly or preview the
            published layout before saving.
          </span>
          <button type="button" onClick={() => changeMode("preview")}>
            Preview
          </button>
        </div>
      ) : null}

      {isSplitPreview ? (
        <div className={styles.markdownSplit}>
          {sourceEditor}
          {renderPreviewPane()}
        </div>
      ) : activeMode === "visual" && visualAvailable ? (
        <SiteAdminVisualEditor
          label={label}
          value={value}
          onChange={onChange}
          minHeight={minHeight}
          placeholder={placeholder}
          disabled={readOnly}
          allowImageUpload={allowImageUpload}
          onEditComponent={onEditComponent}
          onVisualError={(message) => {
            setVisualError(message);
            setMode("source");
          }}
        />
      ) : activeMode === "source" ? (
        sourceEditor
      ) : (
        renderPreviewPane()
      )}
    </div>
  );
}
