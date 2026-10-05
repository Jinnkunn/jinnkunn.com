"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  analyzeVisualMdxCompatibility,
  visualCompatibilitySummary,
} from "@/lib/site-admin/mdx-visual-compatibility";
import { isVisualModeAvailable } from "@/lib/site-admin/mdx-visual-mode";
import styles from "./site-admin-dashboard.module.css";
import { SiteAdminPagePreview } from "./site-admin-page-preview";

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
  persistenceKey?: string;
  pagePreview?: { title: string; home?: boolean };
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

function editorHeadings(value: string) {
  return Array.from(value.matchAll(/^(#{1,3})\s+(.+)$/gm)).map((match) => ({
    level: match[1].length,
    label: match[2].replace(/\s+#+\s*$/, "").trim(),
  }));
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
  persistenceKey = label,
  pagePreview,
}: MarkdownEditorProps) {
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const previewRequestIdRef = useRef(0);
  const lastVisualValueRef = useRef<string | null>(null);
  const readOnly = disabled || blocking;
  const [mode, setMode] = useState<EditorMode>(
    visualEditing ? initialMode : initialMode === "preview" ? "preview" : "source",
  );
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRenderer, setPreviewRenderer] = useState("");
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [pagePreviewOpen, setPagePreviewOpen] = useState(false);
  const [visualError, setVisualError] = useState("");
  const stats = useMemo(() => editorStats(value), [value]);
  const headings = useMemo(() => editorHeadings(value), [value]);
  const visualCompatibility = useMemo(
    () => analyzeVisualMdxCompatibility(value),
    [value],
  );
  const visualAvailable = isVisualModeAvailable({
    visualEditing,
    compatible: visualCompatibility.compatible,
    mode,
    value,
    lastVisualValue: lastVisualValueRef.current,
  });
  const activeMode = mode === "visual" && !visualAvailable ? "source" : mode;
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
      setPreviewRenderer(String(payload?.data?.renderer || payload?.renderer || ""));
      setPreviewSource(value);
    } catch (error: unknown) {
      if (previewRequestIdRef.current !== requestId) return;
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
    try { sessionStorage.setItem(`site-admin:editor-mode:${persistenceKey}`, nextMode); } catch { /* Storage may be unavailable. */ }
  }

  useEffect(() => {
    previewRequestIdRef.current += 1;
    lastVisualValueRef.current = null;
    setPreviewHtml("");
    setPreviewError("");
    setPreviewSource(null);
    setPreviewRenderer("");
    setPreviewLoading(false);
    setVisualError("");
    setPagePreviewOpen(false);
    setMode(visualEditing ? initialMode : initialMode === "preview" ? "preview" : "source");
    try {
      const saved = sessionStorage.getItem(`site-admin:editor-mode:${persistenceKey}`);
      if (saved === "source" || saved === "preview" || (saved === "visual" && visualEditing)) setMode(saved);
    } catch { /* Storage may be unavailable. */ }
  }, [persistenceKey, visualEditing, initialMode]);

  function handleVisualChange(next: string) {
    lastVisualValueRef.current = next;
    onChange(next);
  }

  function jumpToHeading(index: number) {
    const heading = editorRootRef.current?.querySelectorAll<HTMLElement>(
      ".milkdown .ProseMirror h1, .milkdown .ProseMirror h2, .milkdown .ProseMirror h3",
    )[index];
    heading?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderPreviewPane() {
    return (
      <div className={styles.markdownPreviewShell} style={{ minHeight }} aria-busy={previewLoading}>
        <p className={styles.previewStatus} role="status">{previewLoading ? "Refreshing preview…" : previewError ? "Preview could not be refreshed" : previewSource !== value && previewHtml ? "Preview is out of date" : previewHtml ? "Preview up to date" : ""}</p>
        {previewRenderer === "static-mdx-preview" ? (
          <div className={styles.editorModeNotice} role="note">
            Approximate preview: complex MDX may differ from the published page.
          </div>
        ) : null}
        {previewError ? (
          <div className={styles.previewError} role="alert">
            <strong>Preview unavailable</strong>
            <span>{previewError}</span>
            <button type="button" onClick={() => void renderPreview()}>Retry preview</button>
          </div>
        ) : null}
        {previewHtml.trim() ? (
          <div
            className={styles.markdownPreview}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <p className={styles.previewEmpty}>{previewLoading ? "Rendering preview…" : "Nothing to preview yet."}</p>
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
    <div
      ref={editorRootRef}
      className={styles.markdownEditor}
      data-size={size}
      data-layout={previewLayout}
    >
      <div className={styles.editorModeBar}>
        {pagePreview ? <button type="button" className={styles.markdownModeButton} onClick={() => setPagePreviewOpen(true)}>Page preview</button> : null}
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
          {activeMode === "visual" && headings.length > 0 ? (
            <details className={styles.editorOutline}>
              <summary>Outline · {headings.length}</summary>
              <div>
                {headings.map((heading, index) => (
                  <button
                    key={`${heading.level}-${heading.label}-${index}`}
                    type="button"
                    data-level={heading.level}
                    onClick={() => jumpToHeading(index)}
                  >
                    {heading.label}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          {activeMode === "visual" ? <span>Type / for blocks</span> : null}
          {activeMode === "preview" && previewRenderer === "runtime-mdx-preview" ? (
            <span>Published renderer</span>
          ) : null}
          <span>{stats.words} words</span>
          {stats.components > 0 ? <span>{stats.components} components</span> : null}
        </div>
      </div>
      {pagePreviewOpen && pagePreview ? <SiteAdminPagePreview title={pagePreview.title} home={pagePreview.home} source={value} onClose={() => setPagePreviewOpen(false)} /> : null}

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
          onChange={handleVisualChange}
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
