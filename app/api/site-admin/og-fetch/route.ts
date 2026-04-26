import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-og-fetch", maxRequests: 60 };
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;

interface OgCommand {
  url: string;
}

function parseCommand(body: Record<string, unknown>): ParseResult<OgCommand> {
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) return { ok: false, error: "url is required", status: 400 };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "invalid url", status: 400 };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "only http(s) urls are supported", status: 400 };
  }
  // Basic SSRF guard: refuse loopback / link-local / private hostnames. We
  // only inspect the literal hostname; DNS rebinding is out of scope for
  // this admin-only endpoint.
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("169.254.") ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "::1"
  ) {
    return { ok: false, error: "refusing to fetch internal address", status: 400 };
  }
  return { ok: true, value: { url: parsed.toString() } };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function pickMeta(html: string, candidates: string[]): string | undefined {
  for (const name of candidates) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      "i",
    );
    const match = re.exec(html);
    if (match) return decodeHtmlEntities(match[1]);
    const reReversed = new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+(?:property|name)\\s*=\\s*["']${escaped}["']`,
      "i",
    );
    const rev = reReversed.exec(html);
    if (rev) return decodeHtmlEntities(rev[1]);
  }
  return undefined;
}

function pickTitle(html: string): string | undefined {
  const og = pickMeta(html, ["og:title", "twitter:title"]);
  if (og) return og;
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (match) return decodeHtmlEntities(match[1].trim());
  return undefined;
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const parsed = await readSiteAdminJsonCommand(req, parseCommand);
      if (!parsed.ok) return parsed.res;
      const { url } = parsed.value;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; jinnkunn-bookmark/1.0; +https://jinnkunn.com)",
            accept: "text/html,application/xhtml+xml",
          },
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          return apiError(`fetch failed: ${response.status}`, {
            status: 502,
            code: "OG_FETCH_FAILED",
          });
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("html") && !contentType.includes("xml")) {
          return apiError("not an html document", {
            status: 415,
            code: "OG_NOT_HTML",
          });
        }
        // Read up to MAX_BYTES; OG tags live in <head> so this is plenty.
        const reader = response.body?.getReader();
        let html = "";
        let received = 0;
        if (reader) {
          const decoder = new TextDecoder("utf-8", { fatal: false });
          while (received < MAX_BYTES) {
            const { value, done } = await reader.read();
            if (done) break;
            received += value.byteLength;
            html += decoder.decode(value, { stream: true });
            // OG tags must be in <head>; bail once we see </head>.
            if (html.includes("</head>")) break;
          }
          html += decoder.decode();
          await reader.cancel();
        } else {
          html = await response.text();
        }
        const provider = (() => {
          try {
            return new URL(url).hostname.replace(/^www\./, "");
          } catch {
            return undefined;
          }
        })();
        return apiPayloadOk({
          title: pickTitle(html) ?? "",
          description: pickMeta(html, [
            "og:description",
            "twitter:description",
            "description",
          ]) ?? "",
          image: pickMeta(html, ["og:image", "twitter:image"]) ?? "",
          provider: pickMeta(html, ["og:site_name"]) ?? provider ?? "",
        });
      } catch (err) {
        clearTimeout(timer);
        const message =
          err instanceof Error
            ? err.name === "AbortError"
              ? "fetch timed out"
              : err.message
            : "fetch failed";
        return apiError(message, { status: 502, code: "OG_FETCH_FAILED" });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
