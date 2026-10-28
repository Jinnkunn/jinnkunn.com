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

  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    // Release failed responses before a retry; never turn an outage into an
    // apparently successful empty result.
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`Search request failed (${res.status})`);
    }

    const data = (await res.json().catch(() => null)) as unknown;
    return parseSearchResponse(data);
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
