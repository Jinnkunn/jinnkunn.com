"use client";
import { useEffect, useState } from "react";
import { SiteAdminActionDialog } from "./site-admin-action-dialog";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminPagePreview({ title, source, home, onClose }: { title: string; source: string; home?: boolean; onClose: () => void }) {
  const [frame, setFrame] = useState({ html: "", revision: 0 });
  const [frameLoading, setFrameLoading] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [approximate, setApproximate] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch("/api/site-admin/preview/page", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, title, home }), signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Preview unavailable");
        const data = payload.data || payload;
        const css = (data.stylesheets as string[]).filter((url) => /^\/_next\/static\/css\/[a-z0-9_./-]+\.css$/i.test(url)).map((href) => `<link rel="stylesheet" href="${href}">`).join("");
        const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        const classes = Array.from(document.documentElement.classList).filter((name) => /^[a-z0-9_-]+$/i.test(name)).join(" ");
        setFrameLoading(true);
        setFrame((previous) => ({ html: `<!doctype html><html lang="en" class="${classes}" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body>${data.html}</body></html>`, revision: previous.revision + 1 }));
        setApproximate(Boolean(data.approximate));
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [source, title, home, retry]);
  return <SiteAdminActionDialog title="Page preview" onClose={onClose} wide>
    <div className={styles.previewControls} role="group" aria-label="Preview viewport">
      <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>Desktop</button>
      <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>Mobile</button>
    </div>
    <p role="status">{loading || frameLoading ? "Refreshing preview…" : error ? frame.html ? "Preview unavailable. The previous preview is kept below." : "Preview unavailable" : approximate ? "Approximate rendering in the public page shell" : "Draft in the public page shell"}</p>
    <p className={styles.editorHint}>Navigation, footer, and body layout. Live announcements and protected content are not included.</p>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p> : null}
    {/* Same-origin permits local fonts/styles; scripts, forms and top navigation stay blocked. */}
    {frame.html ? <iframe key={frame.revision} title={`${title} page preview`} className={styles.pagePreviewFrame} data-mobile={mobile} srcDoc={frame.html} sandbox="allow-same-origin" onLoad={() => setFrameLoading(false)} /> : null}
  </SiteAdminActionDialog>;
}
