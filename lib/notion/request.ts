import type { NotionRequestOptions } from "./types.ts";

const NOTION_API = "https://api.notion.com/v1";

function notionVersion(): string {
  return (process.env.NOTION_VERSION || "2022-06-28").trim() || "2022-06-28";
}

function notionToken(): string {
  return (process.env.NOTION_TOKEN || "").trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function notionRequest<T = unknown>(
  pathname: string,
  opts: NotionRequestOptions = {},
): Promise<T> {
  const token = String(opts.token ?? notionToken()).trim();
  if (!token) throw new Error("Missing NOTION_TOKEN");

  const version = String(opts.version ?? notionVersion()).trim() || "2022-06-28";
  const maxRetries = Number.isFinite(opts.maxRetries) ? Number(opts.maxRetries) : 4;

  const url = new URL(`${NOTION_API}/${pathname}`);
  if (opts.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": version,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore malformed upstream JSON and treat as null
    }

    if (res.ok) return json as T;

    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    if (!retryable) {
      throw new Error(`Upstream API error ${res.status}: ${String(text).slice(0, 400)}`);
    }

    lastErr = new Error(`Upstream API error ${res.status}: ${String(text).slice(0, 200)}`);
    const ra = res.headers.get("retry-after");
    const raMs = ra && /^\d+$/.test(ra) ? Math.max(0, Number(ra) * 1000) : 0;
    const base = 250 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 100);
    const wait = Math.min(5000, Math.max(raMs, base + jitter));
    await sleep(wait);
  }

  throw lastErr ?? new Error("Upstream API request failed");
}
