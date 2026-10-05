import "server-only";
import fs from "node:fs";
import path from "node:path";
import baked from "@/content/generated/classic-css-assets.json";

export function classicPreviewStylesheets(): string[] {
  try {
    const manifest = fs.readFileSync(path.join(process.cwd(), ".next/server/app/(classic)/page_client-reference-manifest.js"), "utf8");
    const assets = [...manifest.matchAll(/static\/css\/[^"']+\.css/g)].map(([asset]) => `/_next/${asset}`);
    if (assets.length) return [...new Set(assets)];
  } catch { /* Cloudflare bundles use the build-generated manifest. */ }
  return baked.stylesheets.filter((asset) => /^\/_next\/static\/css\/.+\.css$/.test(asset));
}
