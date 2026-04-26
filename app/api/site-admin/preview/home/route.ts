import type { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

import generatedClassicCssAssets from "@/content/generated/classic-css-assets.json";
import { HomeView } from "@/components/home/home-view";
import { normalizeHomeData } from "@/lib/site-admin/home-normalize";
import { findContentFile, readJsonFile } from "@/lib/server/content-files";
import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-home-preview", maxRequests: 120 };

function normalizeStylesheets(raw: unknown): string[] {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { stylesheets?: unknown }).stylesheets
      : raw;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter((item) => item.startsWith("/_next/static/css/") && item.endsWith(".css"))
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function readGeneratedClassicStylesheets(): string[] {
  const baked = normalizeStylesheets(generatedClassicCssAssets);
  if (baked.length > 0) return baked;

  const file = findContentFile("classic-css-assets.json");
  if (!file) return [];
  return normalizeStylesheets(readJsonFile(file));
}

function readClassicPageStylesheets(): string[] {
  const rel = path.join(
    ".next",
    "server",
    "app",
    "(classic)",
    "page_client-reference-manifest.js",
  );
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), "server-functions", "default", rel),
    path.join(
      process.cwd(),
      "server-functions",
      "default",
      ".next",
      "server",
      "app",
      "(classic)",
      "page_client-reference-manifest.js",
    ),
    path.join(process.cwd(), ".open-next", "server-functions", "default", rel),
    path.join(
      process.cwd(),
      ".open-next",
      "server-functions",
      "default",
      ".next",
      "server",
      "app",
      "(classic)",
      "page_client-reference-manifest.js",
    ),
  ];

  for (const candidate of candidates) {
    try {
      const source = fs.readFileSync(candidate, "utf8");
      const assets = normalizeStylesheets(
        [...source.matchAll(/static\/css\/[^"']+\.css/g)].map(
          (match) => `/_next/${match[0]}`,
        ),
      );
      if (assets.length > 0) return assets;
    } catch {
      // Development and some serverless bundles may not expose the manifest.
    }
  }
  return readGeneratedClassicStylesheets();
}

function parseCommand(raw: Record<string, unknown>):
  | { ok: true; value: { data: unknown } }
  | { ok: false; error: string; status: number } {
  if (!("data" in raw)) {
    return { ok: false, error: "Missing `data` object", status: 400 };
  }
  return { ok: true, value: { data: raw.data } };
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const parsed = await readSiteAdminJsonCommand(req, parseCommand);
      if (!parsed.ok) return parsed.res;
      try {
        const data = normalizeHomeData(parsed.value.data);
        const element = await HomeView({ data, previewStaticImages: true });
        const { renderToStaticMarkup } = await import("react-dom/server");
        const html = renderToStaticMarkup(element);
        return apiPayloadOk({ html, stylesheets: readClassicPageStylesheets() });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return apiError(msg, { status: 500, code: "PREVIEW_FAILED" });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
