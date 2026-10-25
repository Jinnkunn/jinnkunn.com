"use client";
import { useEffect, useMemo, useState } from "react";
import type { PagePreviewOptions } from "@/lib/site-admin/page-preview-context";
import { SiteAdminActionDialog } from "./site-admin-action-dialog";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminPagePreview({ title, source, home, routePath, announcement, component, document: draftDocument, onClose }: PagePreviewOptions & { source: string; onClose: () => void }) {
  const [frame, setFrame] = useState({ html: "", css: "", classes: "", revision: 0 });
  const [frameLoading, setFrameLoading] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState("light");
  const [includeAnnouncement, setIncludeAnnouncement] = useState(true);
  const [display, setDisplay] = useState("route");
  const [context, setContext] = useState<{ snapshotSha?: string; routePath?: string; announcement?: boolean; announcementDraft?: boolean; monochrome?: boolean }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [approximate, setApproximate] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = JSON.stringify({ source, title, home, routePath, announcement, component, document: draftDocument, includeAnnouncement, display });
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const position = { x: window.scrollX, y: window.scrollY };
    const containers = new Set<HTMLElement>();
    for (const editor of document.querySelectorAll<HTMLElement>(".cm-scroller, .ProseMirror, [data-structured-entry-form]")) {
      for (let node: HTMLElement | null = editor; node && node !== document.body; node = node.parentElement) if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) containers.add(node);
    }
    const scrolls = [...containers].map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft }));
    return () => { window.requestAnimationFrame(() => {
      for (const { node, top, left } of scrolls) if (node.isConnected) node.scrollTo({ top, left, behavior: "instant" });
      window.scrollTo({ top: position.y, left: position.x, behavior: "instant" });
    }); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        const response = await fetch("/api/site-admin/preview/page", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: request, signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Preview unavailable");
        if (controller.signal.aborted) return;
        const data = payload.data || payload;
        const css = (data.stylesheets as string[]).filter((url) => /^\/_next\/static\/css\/[a-z0-9_./-]+\.css$/i.test(url)).map((href) => `<link rel="stylesheet" href="${href}">`).join("");
        const classes = Array.from(document.documentElement.classList).filter((name) => /^[a-z0-9_-]+$/i.test(name)).join(" ");
        setFrameLoading(true);
        setFrame((previous) => ({ html: String(data.html), css, classes, revision: previous.revision + 1 }));
        setContext(data.context || {}); setApproximate(Boolean(data.approximate));
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [request, retry]);
  const documentHtml = useMemo(() => `<!doctype html><html lang="en" class="${frame.classes}" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${frame.css}</head><body>${frame.html}</body></html>`, [frame, theme]);
  return <SiteAdminActionDialog title="Page preview" onClose={onClose} wide>
    <div className={styles.previewControls}>
      <div role="group" aria-label="Preview viewport">
        <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>Desktop</button>
        <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>Mobile</button>
      </div>
      <label>Theme <select aria-label="Preview theme" value={theme} onChange={(event) => setTheme(event.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label><input type="checkbox" checked={includeAnnouncement} onChange={(event) => setIncludeAnnouncement(event.target.checked)} />Include announcement</label>
      <label>Announcement <select aria-label="Announcement display" value={display} disabled={!includeAnnouncement} onChange={(event) => setDisplay(event.target.value)}><option value="route">Page default</option><option value="expanded">Expanded</option><option value="compact">Collapsed</option></select></label>
    </div>
    <p role="status">{loading || frameLoading ? "Refreshing preview…" : error ? frame.html ? "Preview unavailable. The previous preview is kept below." : "Preview unavailable" : approximate ? "Approximate rendering in the public page shell" : "Draft in the public page shell"}</p>
    <p className={styles.editorHint}>{context.routePath || routePath || (home ? "/" : "/preview")} · {context.announcementDraft ? "Unsaved announcement" : context.announcement ? "Published announcement" : "No announcement"} · {context.monochrome ? "Monochrome" : "Standard appearance"} · Published context {context.snapshotSha?.slice(0, 7) || "unavailable"}. Interactive widgets are inactive.</p>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p> : null}
    {frame.html ? <iframe key={frame.revision} title={`${title} page preview`} className={styles.pagePreviewFrame} data-mobile={mobile} srcDoc={documentHtml} sandbox="allow-same-origin" onLoad={(event) => {
      setFrameLoading(false);
      event.currentTarget.contentDocument?.addEventListener("click", (event) => {
        if ((event.target as Element)?.closest?.("a")) event.preventDefault();
      });
    }} /> : null}
  </SiteAdminActionDialog>;
}
