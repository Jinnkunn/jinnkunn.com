import { NextResponse } from "next/server";

import { dashify32 } from "@/lib/shared/route-utils";
import { notionRequest } from "@/lib/notion/api";

type NotionBlock = {
  type?: string;
  image?: {
    type?: "file" | "external";
    file?: { url?: string };
    external?: { url?: string };
  };
  file?: {
    type?: "file" | "external";
    file?: { url?: string };
    external?: { url?: string };
  };
  pdf?: {
    type?: "file" | "external";
    file?: { url?: string };
    external?: { url?: string };
  };
};

type NotionAssetPayload = {
  type?: "file" | "external";
  file?: { url?: string };
  external?: { url?: string };
};

function pickAssetUrl(block: NotionBlock): string {
  const t = String(block?.type || "");
  const obj = (block as Record<string, unknown>)?.[t] as NotionAssetPayload | undefined;
  if (!obj || typeof obj !== "object") return "";
  const kind = String(obj.type || "");
  if (kind === "external") return String(obj.external?.url || "");
  if (kind === "file") return String(obj.file?.url || "");
  return "";
}

// Fallback for Notion-hosted "file" assets:
// - Our sync tries to download to /public/notion-assets at build time.
// - If that directory isn't present in a deployment (or a file is missing),
//   this route resolves the latest signed URL from Notion and redirects.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const m = String(file || "").match(/^([0-9a-f]{32})\.[a-z0-9]{1,6}$/i);
  if (!m) return new NextResponse("Not found", { status: 404 });

  const notionToken = process.env.NOTION_TOKEN || "";
  if (!notionToken) return new NextResponse("Not configured", { status: 404 });

  const dashed = dashify32(m[1]!);
  if (!dashed) return new NextResponse("Not found", { status: 404 });

  const block = (await notionRequest(`blocks/${dashed}`, {
    token: notionToken,
    maxRetries: 2,
  }).catch(() => null)) as NotionBlock | null;
  if (!block) return new NextResponse("Not found", { status: 404 });

  const url = pickAssetUrl(block);
  if (!url) return new NextResponse("Not found", { status: 404 });

  // Notion "file" URLs are short-lived (S3 signed URLs). Keep CDN cache short.
  const out = NextResponse.redirect(url, { status: 302 });
  out.headers.set(
    "Cache-Control",
    "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
  );
  return out;
}
