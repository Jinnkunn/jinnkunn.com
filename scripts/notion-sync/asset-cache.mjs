import fs from "node:fs";
import path from "node:path";

import { ensureDir, readJsonFile, writeJsonAtomic } from "./fs-utils.mjs";

function parseForceEnv(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export function createAssetDownloader({
  outPublicAssetsDir,
  cacheDir,
  force,
}) {
  const forceDownload = typeof force === "boolean"
    ? force
    : parseForceEnv(process.env.NOTION_SYNC_FORCE);
  const assetIndexPath = cacheDir
    ? path.join(cacheDir, "asset-index.json")
    : "";

  const emptyIndex = { byStableName: {}, byUrlKey: {} };
  const loaded = assetIndexPath ? readJsonFile(assetIndexPath) : null;
  const index =
    loaded &&
    typeof loaded === "object" &&
    loaded.byStableName &&
    loaded.byUrlKey &&
    typeof loaded.byStableName === "object" &&
    typeof loaded.byUrlKey === "object"
      ? loaded
      : emptyIndex;

  function persistIndex() {
    if (!assetIndexPath) return;
    writeJsonAtomic(assetIndexPath, index);
  }

  function isExistingPublicAsset(publicPath) {
    const rel = String(publicPath || "").trim().replace(/^\/+/, "");
    if (!rel) return false;
    const abs = path.join(process.cwd(), "public", rel);
    try {
      return fs.statSync(abs).isFile();
    } catch {
      return false;
    }
  }

  function normalizeUrlKey(rawUrl) {
    try {
      const u = new URL(String(rawUrl || ""));
      const host = String(u.hostname || "").toLowerCase();
      const pathPart = String(u.pathname || "");
      // Notion file links are signed and query params rotate frequently.
      // Cache by host+path to avoid redownloading identical files on each sync.
      if (
        host.includes("notion-static.com") ||
        host.endsWith("notion.so") ||
        host.includes("amazonaws.com")
      ) {
        return `${u.protocol}//${host}${pathPart}`;
      }
      // For other hosts keep query params to avoid accidental collisions.
      const qs = String(u.search || "");
      return `${u.protocol}//${host}${pathPart}${qs}`;
    } catch {
      return String(rawUrl || "").trim();
    }
  }

  return async function downloadAsset(url, stableName) {
    const u = new URL(url);
    const pathname = u.pathname || "";
    const extMatch = pathname.match(/\.([a-z0-9]{1,5})$/i);
    const ext = (extMatch?.[1] || "bin").toLowerCase();
    const fileName = `${stableName}.${ext}`;
    const filePath = path.join(outPublicAssetsDir, fileName);
    const publicPath = `/notion-assets/${fileName}`;
    const urlKey = normalizeUrlKey(url);
    const stableKey = String(stableName || "").trim();

    if (!forceDownload && stableKey) {
      const cachedByStable = index.byStableName?.[stableKey];
      if (isExistingPublicAsset(cachedByStable)) return cachedByStable;
    }

    if (!forceDownload && urlKey) {
      const cachedByUrl = index.byUrlKey?.[urlKey];
      if (isExistingPublicAsset(cachedByUrl)) {
        if (stableKey) {
          index.byStableName[stableKey] = cachedByUrl;
          persistIndex();
        }
        return cachedByUrl;
      }
    }

    if (!forceDownload) {
      try {
        if (fs.statSync(filePath).isFile()) {
          if (stableKey) index.byStableName[stableKey] = publicPath;
          if (urlKey) index.byUrlKey[urlKey] = publicPath;
          persistIndex();
          return publicPath;
        }
      } catch {
        // continue
      }
    }

    ensureDir(outPublicAssetsDir);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Asset download failed ${res.status}: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    if (stableKey) index.byStableName[stableKey] = publicPath;
    if (urlKey) index.byUrlKey[urlKey] = publicPath;
    persistIndex();
    return publicPath;
  };
}
