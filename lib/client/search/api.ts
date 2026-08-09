import { parseSearchResponse } from "@/lib/shared/search-contract";
import type { SearchMeta, SearchItem } from "@/lib/shared/search-contract";

export async function fetchSearchResults(
  q: string,
  opts: { type: string; scope: string; offset: number; limit: number },
  signal: AbortSignal,
): Promise<{ items: SearchItem[]; meta: SearchMeta | null }> {
  const url = new URL("/api/search", window.location.origin);
  url.searchParams.set("q", q);
  if (opts.type && opts.type !== "all") url.searchParams.set("type", opts.type);
  if (opts.scope) url.searchParams.set("scope", opts.scope);
  if (opts.offset > 0) url.searchParams.set("offset", String(opts.offset));
  if (opts.limit && opts.limit !== 20) url.searchParams.set("limit", String(opts.limit));

  const res = await fetch(url, { signal, headers: { "cache-control": "no-store" } });
  // Reject instead of returning an empty payload: swallowing the status made a 500 from
  // /api/search indistinguishable from a query that genuinely matched nothing, and the
  // overlay then told the user "No results". The only 4xx this route emits is an invalid
  // `type`, which the client can never send (the pills are a fixed whitelist).
  if (!res.ok) throw new Error(`Search request failed (${res.status})`);

  const data = (await res.json().catch(() => null)) as unknown;
  return parseSearchResponse(data);
}
