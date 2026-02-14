import fs from "node:fs";
import path from "node:path";

import { ensureDir } from "./fs-utils.mjs";

function parseForceEnv(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export function createAssetDownloader({
  outPublicAssetsDir,
  force,
}) {
  const forceDownload = typeof force === "boolean"
    ? force
    : parseForceEnv(process.env.NOTION_SYNC_FORCE);

  return async function downloadAsset(url, stableName) {
    const u = new URL(url);
    const pathname = u.pathname || "";
    const extMatch = pathname.match(/\.([a-z0-9]{1,5})$/i);
    const ext = (extMatch?.[1] || "bin").toLowerCase();
    const fileName = `${stableName}.${ext}`;
    const filePath = path.join(outPublicAssetsDir, fileName);
    const publicPath = `/notion-assets/${fileName}`;

    if (!forceDownload) {
      try {
        if (fs.statSync(filePath).isFile()) return publicPath;
      } catch {
        // continue
      }
    }

    ensureDir(outPublicAssetsDir);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Asset download failed ${res.status}: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    return publicPath;
  };
}
