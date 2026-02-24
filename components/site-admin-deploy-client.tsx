"use client";

import { useEffect, useState } from "react";
import type {
  SiteAdminDeployPreviewResult,
  SiteAdminDeployResult,
} from "@/lib/site-admin/api-types";
import { fetchSiteAdminDeployPreview } from "@/lib/client/site-admin-deploy-preview";
import { triggerSiteAdminDeploy } from "@/lib/client/site-admin-deploy";

export default function SiteAdminDeployClient() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SiteAdminDeployResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewRes, setPreviewRes] = useState<SiteAdminDeployPreviewResult | null>(null);

  const loadPreview = async () => {
    if (previewBusy) return;
    setPreviewBusy(true);
    const data = await fetchSiteAdminDeployPreview();
    setPreviewRes(data);
    setPreviewBusy(false);
  };

  useEffect(() => {
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDeploy = async () => {
    setBusy(true);
    setRes(null);
    const data = await triggerSiteAdminDeploy();
    setRes(data);
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="site-admin-deploy-preview">
        <div className="site-admin-deploy-preview__head">
          <div className="site-admin-deploy-preview__title">Deploy Preview</div>
          <button
            type="button"
            className="site-admin-deploy-preview__refresh"
            onClick={() => void loadPreview()}
            disabled={previewBusy}
          >
            {previewBusy ? "Checking..." : "Refresh"}
          </button>
        </div>

        {previewRes ? (
          previewRes.ok ? (
            <>
              <p className="site-admin-deploy-preview__summary">
                {previewRes.hasChanges ? "Changes detected:" : "No config or route changes detected."}{" "}
                <code className="code">{previewRes.generatedAt}</code>
              </p>
              <div className="site-admin-deploy-preview__stats">
                <span>+ Pages: {previewRes.summary.pagesAdded}</span>
                <span>- Pages: {previewRes.summary.pagesRemoved}</span>
                <span>Redirects: {previewRes.summary.redirectsAdded + previewRes.summary.redirectsRemoved + previewRes.summary.redirectsChanged}</span>
                <span>Protected: {previewRes.summary.protectedAdded + previewRes.summary.protectedRemoved + previewRes.summary.protectedChanged}</span>
              </div>

              {previewRes.samples.pagesAdded.length ? (
                <details className="site-admin-deploy-preview__details">
                  <summary>Added Pages</summary>
                  <ul>
                    {previewRes.samples.pagesAdded.map((path) => (
                      <li key={path}>
                        <code className="code">{path}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {previewRes.samples.pagesRemoved.length ? (
                <details className="site-admin-deploy-preview__details">
                  <summary>Removed Pages</summary>
                  <ul>
                    {previewRes.samples.pagesRemoved.map((path) => (
                      <li key={path}>
                        <code className="code">{path}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {previewRes.samples.redirects.length ? (
                <details className="site-admin-deploy-preview__details">
                  <summary>Redirect / Route Changes</summary>
                  <ul>
                    {previewRes.samples.redirects.map((item, idx) => (
                      <li key={`${item.pageId}-${item.fromPath}-${item.toPath}-${idx}`}>
                        <code className="code">{item.fromPath}</code> {" -> "}
                        <code className="code">{item.toPath}</code>{" "}
                        <span className="site-admin-deploy-preview__muted">
                          ({item.kind}, {item.source})
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {previewRes.samples.protected.length ? (
                <details className="site-admin-deploy-preview__details">
                  <summary>Protected Rule Changes</summary>
                  <ul>
                    {previewRes.samples.protected.map((item, idx) => (
                      <li key={`${item.pageId}-${item.path}-${idx}`}>
                        <code className="code">{item.path}</code>{" "}
                        <span className="site-admin-deploy-preview__muted">
                          ({item.kind}, {item.auth}, {item.mode})
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <p className="site-admin-deploy-preview__error">{previewRes.error}</p>
          )
        ) : (
          <p className="site-admin-deploy-preview__summary">Loading preview...</p>
        )}
      </div>

      <button
        type="button"
        onClick={onDeploy}
        disabled={busy}
        style={{
          height: 40,
          width: "fit-content",
          padding: "0 14px",
          borderRadius: 10,
          border: "1px solid var(--color-border-default)",
          background: "var(--color-card-bg)",
          color: "var(--color-text-default)",
          cursor: busy ? "not-allowed" : "pointer",
          fontWeight: 650,
        }}
      >
        {busy ? "Deploying..." : "Deploy"}
      </button>

      {res ? (
        <p className="notion-text notion-text__content notion-semantic-string">
          {res.ok ? (
            <>
              Deploy triggered ({res.status}) at <code className="code">{res.triggeredAt}</code>.
            </>
          ) : (
            <span className="highlighted-color color-red">{res.error}</span>
          )}
        </p>
      ) : null}
    </div>
  );
}
