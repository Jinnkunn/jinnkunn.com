"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";
import styles from "./site-admin-dashboard.module.css";

export type SiteAdminAsset = {
  key: string;
  url: string;
  filename: string;
  size: number;
  contentType: string;
  version: string;
  uploadedAt: string;
};

type AssetsPayload = { assets: SiteAdminAsset[] };

function unwrapPayload<T>(raw: unknown): T {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as { ok?: unknown }).ok === true &&
    Object.prototype.hasOwnProperty.call(raw, "data")
  ) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

async function requestAssets<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/site-admin/assets", {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const raw = await response.json().catch(() => null);
  const error = raw as { error?: string } | null;
  if (!response.ok) throw new Error(error?.error || `Asset request failed (${response.status})`);
  return unwrapPayload<T>(raw);
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    out += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(out);
}

export async function uploadSiteAdminAsset(file: File): Promise<SiteAdminAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploaded = await requestAssets<{
    key: string;
    url: string;
    size: number;
    contentType: string;
    version: string;
  }>({
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      base64: bytesToBase64(bytes),
    }),
  });
  return {
    ...uploaded,
    filename: file.name,
    uploadedAt: new Date().toISOString(),
  };
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function SiteAdminMediaLibrary({
  mode = "manage",
  onSelect,
  onClose,
}: {
  mode?: "manage" | "pick";
  onSelect?: (asset: SiteAdminAsset) => void;
  onClose?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [assets, setAssets] = useState<SiteAdminAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadAssets() {
    setLoading(true);
    setError("");
    try {
      const payload = await requestAssets<AssetsPayload>();
      setAssets(payload.assets || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAssets();
  }, []);

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return assets;
    return assets.filter((asset) =>
      [asset.filename, asset.key, asset.contentType].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [assets, query]);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((file) => file.size > 0);
    if (list.length === 0) return;
    setBusyKey("upload");
    setError("");
    setNotice("");
    try {
      const uploaded: SiteAdminAsset[] = [];
      for (const file of list) uploaded.push(await uploadSiteAdminAsset(file));
      setAssets((current) => [...uploaded, ...current]);
      setNotice(`${uploaded.length} asset${uploaded.length === 1 ? "" : "s"} uploaded.`);
      if (mode === "pick" && uploaded[0] && onSelect) onSelect(uploaded[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function deleteAsset(asset: SiteAdminAsset) {
    if (!window.confirm(`Delete ${asset.filename}?`)) return;
    setBusyKey(asset.key);
    setError("");
    try {
      await requestAssets<{ deleted: true }>({
        method: "DELETE",
        body: JSON.stringify({ key: asset.key, version: asset.version }),
      });
      setAssets((current) => current.filter((item) => item.key !== asset.key));
      setNotice(`${asset.filename} deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey("");
    }
  }

  return (
    <section className={styles.mediaLibrary} aria-label="Media library">
      <div className={styles.mediaHeader}>
        <div>
          <h2 className={styles.panelTitle}>{mode === "pick" ? "Choose media" : "Media"}</h2>
          <p className={styles.cardText}>Upload once, then reuse the asset in content and metadata.</p>
        </div>
        <div className={styles.panelActions}>
          {onClose ? (
            <Button onClick={onClose} variant="ghost" size="sm">
              Close
            </Button>
          ) : null}
          <Button
            onClick={() => inputRef.current?.click()}
            tone="accent"
            size="sm"
            disabled={busyKey === "upload"}
          >
            {busyKey === "upload" ? "Uploading" : "Upload"}
          </Button>
          <input
            ref={inputRef}
            className={styles.visuallyHidden}
            type="file"
            accept="image/*"
            multiple={mode === "manage"}
            onChange={(event) => {
              if (event.target.files) void uploadFiles(event.target.files);
            }}
          />
        </div>
      </div>

      {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
      {error ? <StatusNotice tone="danger">{error}</StatusNotice> : null}

      <label className={styles.fieldLabel}>
        Search
        <input
          className={styles.textField}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filename or type"
        />
      </label>

      <div
        className={styles.assetDropZone}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void uploadFiles(event.dataTransfer.files);
        }}
      >
        Drop images here to upload
      </div>

      {loading ? <p className={styles.listEmpty}>Loading media…</p> : null}
      {!loading && visibleAssets.length === 0 ? (
        <p className={styles.listEmpty}>No matching assets.</p>
      ) : null}
      <div className={styles.assetGrid}>
        {visibleAssets.map((asset) => (
          <article key={asset.key} className={styles.assetItem}>
            <button
              type="button"
              className={styles.assetPreview}
              onClick={() => onSelect?.(asset)}
              disabled={!onSelect}
              aria-label={onSelect ? `Use ${asset.filename}` : asset.filename}
            >
              {asset.contentType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.url} alt="" />
              ) : (
                <span>{asset.contentType}</span>
              )}
            </button>
            <div className={styles.assetMeta}>
              <strong title={asset.filename}>{asset.filename}</strong>
              <small>{formatBytes(asset.size)}</small>
            </div>
            <div className={styles.assetActions}>
              {onSelect ? (
                <Button onClick={() => onSelect(asset)} tone="accent" size="sm">
                  Use
                </Button>
              ) : (
                <Button
                  onClick={() => void navigator.clipboard.writeText(asset.url)}
                  variant="subtle"
                  size="sm"
                >
                  Copy URL
                </Button>
              )}
              <Button
                onClick={() => void deleteAsset(asset)}
                variant="ghost"
                tone="danger"
                size="sm"
                disabled={busyKey === asset.key}
              >
                Delete
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
