import { useEffect, useState } from "react";

import { useSiteAdmin } from "./state";
import type { AssetUploadResponse } from "./types";
import { normalizeString } from "./utils";

const RECENT_ASSETS_KEY = "workspace.site-admin.assets.recent.v1";
const MAX_RECENT_ASSETS = 24;

export type RecentAsset = {
  url: string;
  key?: string;
  filename?: string;
  alt?: string;
  contentType?: string;
  size?: number;
  version?: string;
  uploadedAt: string;
};

function readRecentAssets(): RecentAsset[] {
  try {
    const raw = localStorage.getItem(RECENT_ASSETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): RecentAsset | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const url = typeof record.url === "string" ? record.url.trim() : "";
        if (!url) return null;
        return {
          url,
          ...(typeof record.key === "string" ? { key: record.key } : {}),
          ...(typeof record.filename === "string"
            ? { filename: record.filename }
            : {}),
          ...(typeof record.alt === "string" ? { alt: record.alt } : {}),
          ...(typeof record.contentType === "string"
            ? { contentType: record.contentType }
            : {}),
          ...(typeof record.size === "number" ? { size: record.size } : {}),
          ...(typeof record.version === "string" ? { version: record.version } : {}),
          uploadedAt:
            typeof record.uploadedAt === "string"
              ? record.uploadedAt
              : new Date().toISOString(),
        } satisfies RecentAsset;
      })
      .filter((asset): asset is RecentAsset => Boolean(asset));
  } catch {
    return [];
  }
}

function writeRecentAssets(assets: RecentAsset[]): void {
  try {
    localStorage.setItem(
      RECENT_ASSETS_KEY,
      JSON.stringify(assets.slice(0, MAX_RECENT_ASSETS)),
    );
  } catch {
    // Best-effort convenience cache only.
  }
}

export function rememberRecentAsset(
  asset: AssetUploadResponse,
  filename?: string,
): RecentAsset {
  const next: RecentAsset = {
    url: asset.url,
    ...(asset.key ? { key: asset.key } : {}),
    ...(filename ? { filename, alt: filename } : {}),
    ...(asset.contentType ? { contentType: asset.contentType } : {}),
    ...(asset.size ? { size: asset.size } : {}),
    ...(asset.version ? { version: asset.version } : {}),
    uploadedAt: new Date().toISOString(),
  };
  const existing = readRecentAssets().filter((item) => item.url !== next.url);
  writeRecentAssets([next, ...existing]);
  window.dispatchEvent(new Event("site-admin:recent-assets"));
  return next;
}

export function AssetLibraryPicker({
  currentUrl,
  onSelect,
}: {
  currentUrl?: string;
  onSelect: (asset: RecentAsset) => void;
}) {
  const { connection, request, setMessage } = useSiteAdmin();
  const [recentAssets, setRecentAssets] = useState<RecentAsset[]>(() => readRecentAssets());
  const [serverAssets, setServerAssets] = useState<RecentAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedUrl = currentUrl?.trim() || "";
  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const loadAssets = async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    const response = await request("/api/site-admin/assets", "GET");
    setLoading(false);
    if (!response.ok) {
      setError(`${response.code}: ${response.error}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const rawAssets = Array.isArray(data.assets) ? data.assets : [];
    setServerAssets(
      rawAssets
        .map((item): RecentAsset | null => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const url = normalizeString(record.url);
          const key = normalizeString(record.key);
          const filename = normalizeString(record.filename) || key.split("/").pop();
          const contentType = normalizeString(record.contentType);
          const version = normalizeString(record.version);
          const uploadedAt = normalizeString(record.uploadedAt);
          if (!url || !key) return null;
          return {
            url,
            key,
            ...(filename ? { filename } : {}),
            ...(contentType ? { contentType } : {}),
            ...(typeof record.size === "number" ? { size: record.size } : {}),
            ...(version ? { version } : {}),
            uploadedAt: uploadedAt || new Date().toISOString(),
          };
        })
        .filter((asset): asset is RecentAsset => Boolean(asset)),
    );
  };

  useEffect(() => {
    const refresh = () => setRecentAssets(readRecentAssets());
    window.addEventListener("site-admin:recent-assets", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("site-admin:recent-assets", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    void loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const assets = (serverAssets.length > 0 ? serverAssets : recentAssets).filter((asset) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [asset.filename, asset.key, asset.url, asset.contentType]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(needle));
  });

  const deleteServerAsset = async (asset: RecentAsset) => {
    if (!asset.key || !asset.version || !ready) return;
    const response = await request("/api/site-admin/assets", "DELETE", {
      key: asset.key,
      version: asset.version,
    });
    if (!response.ok) {
      setMessage("error", `Delete asset failed: ${response.code}: ${response.error}`);
      return;
    }
    setMessage("success", "Asset deleted.");
    await loadAssets();
  };

  if (assets.length === 0) {
    return (
      <div className="asset-library asset-library--empty">
        <div className="asset-library__head">
          <span>Asset library</span>
          {ready && (
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => void loadAssets()}
              disabled={loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          )}
        </div>
        <p>Recent uploads will appear here for reuse.</p>
        {error && <p className="asset-library__error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="asset-library">
      <div className="asset-library__head">
        <span>Asset library</span>
        <div className="asset-library__head-actions">
          {ready && (
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => void loadAssets()}
              disabled={loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          )}
          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => {
              writeRecentAssets([]);
              setRecentAssets([]);
            }}
          >
            Clear local
          </button>
        </div>
      </div>
      <input
        className="asset-library__search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search assets"
      />
      {error && <p className="asset-library__error">{error}</p>}
      <div className="asset-library__grid">
        {assets.map((asset) => {
          const active = selectedUrl === asset.url;
          return (
            <div
              className="asset-library__item"
              data-active={active ? "true" : undefined}
              key={asset.url}
              title={asset.url}
            >
              <button
                className="asset-library__pick"
                type="button"
                onClick={() => onSelect(asset)}
              >
                {asset.contentType?.startsWith("image/") ? (
                  // Tauri/Vite surface, not a Next.js page; next/image is unavailable here.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset.url} alt={asset.alt || asset.filename || "Asset"} />
                ) : (
                  <span className="asset-library__file">File</span>
                )}
                <span>{asset.filename || asset.key || asset.url}</span>
              </button>
              {asset.key && asset.version && ready && (
                <button
                  className="asset-library__delete"
                  type="button"
                  onClick={() => void deleteServerAsset(asset)}
                >
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
