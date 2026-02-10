import { compactId } from "../shared/route-utils.mjs";

const NOTION_API = "https://api.notion.com/v1";

function notionVersion() {
  return (process.env.NOTION_VERSION || "2022-06-28").trim() || "2022-06-28";
}

function notionToken() {
  return (process.env.NOTION_TOKEN || "").trim();
}

/**
 * @param {number} ms
 */
async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * @typedef {{
 *   method?: string,
 *   body?: unknown,
 *   searchParams?: Record<string, string | number | boolean | null | undefined>,
 *   token?: string,
 *   version?: string,
 *   maxRetries?: number,
 * }} NotionRequestOptions
 */

/**
 * Minimal Notion API request wrapper with retry/backoff for rate limits and 5xx.
 * Returns parsed JSON (or null).
 *
 * @param {string} pathname
 * @param {NotionRequestOptions} [opts]
 * @returns {Promise<any>}
 */
export async function notionRequest(pathname, opts = {}) {
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

  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": version,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let lastErr = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (res.ok) return json;

    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    if (!retryable) {
      throw new Error(`Upstream API error ${res.status}: ${String(text).slice(0, 400)}`);
    }

    lastErr = new Error(`Upstream API error ${res.status}: ${String(text).slice(0, 200)}`);

    // Respect Retry-After (seconds) when present.
    const ra = res.headers.get("retry-after");
    const raMs = ra && /^\d+$/.test(ra) ? Math.max(0, Number(ra) * 1000) : 0;

    // Exponential backoff with a bit of jitter.
    const base = 250 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 100);
    const wait = Math.min(5000, Math.max(raMs, base + jitter));
    await sleep(wait);
  }

  throw lastErr ?? new Error("Upstream API request failed");
}

/**
 * @param {string} blockId
 * @returns {Promise<any[]>}
 */
export async function listBlockChildren(blockId) {
  const out = [];
  let cursor = undefined;
  const id = compactId(blockId);
  for (;;) {
    const data = await notionRequest(`blocks/${id}/children`, {
      searchParams: cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 },
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.has_more) break;
    cursor = data?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/**
 * @param {string} databaseId
 * @param {{ filter?: unknown, sorts?: unknown }} [opts]
 * @returns {Promise<any[]>}
 */
export async function queryDatabase(databaseId, opts = {}) {
  const out = [];
  let cursor = undefined;
  const id = compactId(databaseId);
  for (;;) {
    const body = { page_size: 100, start_cursor: cursor };
    if (opts.filter !== undefined) body.filter = opts.filter;
    if (opts.sorts !== undefined) body.sorts = opts.sorts;
    const data = await notionRequest(`databases/${id}/query`, { method: "POST", body });
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.has_more) break;
    cursor = data?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/**
 * Read a Notion property from a page and return a simple string (best-effort).
 * @param {any} page
 * @param {string} name
 * @returns {string}
 */
export function getPropString(page, name) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  const p = props?.[name];
  if (!p || typeof p !== "object") return "";

  if (p.type === "title") return richTextPlain(p.title);
  if (p.type === "rich_text") return richTextPlain(p.rich_text);
  if (p.type === "select") return String(p.select?.name ?? "").trim();
  return "";
}

/**
 * @param {any} page
 * @param {string} name
 * @returns {number | null}
 */
export function getPropNumber(page, name) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  const p = props?.[name];
  if (!p || typeof p !== "object") return null;
  if (p.type !== "number") return null;
  return typeof p.number === "number" ? p.number : null;
}

/**
 * @param {any} page
 * @param {string} name
 * @returns {boolean | null}
 */
export function getPropCheckbox(page, name) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  const p = props?.[name];
  if (!p || typeof p !== "object") return null;
  if (p.type !== "checkbox") return null;
  return typeof p.checkbox === "boolean" ? p.checkbox : null;
}

/**
 * @param {any[] | undefined | null} rt
 * @returns {string}
 */
export function richTextPlain(rt) {
  if (!Array.isArray(rt)) return "";
  return rt.map((x) => x?.plain_text ?? "").join("").trim();
}
