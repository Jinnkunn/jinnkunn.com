// Pure types + helpers for the redirects manifest. Lives in its own
// file so build-time consumers (next.config.mjs) and test code can
// import it without dragging in the content-store / IO stack that
// `lib/redirects.ts` needs at runtime.

export type RedirectKind = "pages" | "posts";

export interface RedirectsTable {
  pages: Record<string, string>;
  posts: Record<string, string>;
}

export function emptyRedirectsTable(): RedirectsTable {
  return { pages: {}, posts: {} };
}

export function normalizeRedirectsTable(raw: unknown): RedirectsTable {
  if (!raw || typeof raw !== "object") return emptyRedirectsTable();
  const obj = raw as Record<string, unknown>;
  const out = emptyRedirectsTable();
  for (const kind of ["pages", "posts"] as const) {
    const sub = obj[kind];
    if (sub && typeof sub === "object" && !Array.isArray(sub)) {
      for (const [from, to] of Object.entries(sub)) {
        if (typeof from === "string" && typeof to === "string" && from && to) {
          out[kind][from] = to;
        }
      }
    }
  }
  return out;
}

/** Used by next.config.mjs at build time. Returns Next-shaped redirect
 * descriptors for both /pages/<slug> and the root /<slug> mount. */
export function buildNextRedirects(
  table: RedirectsTable,
): Array<{ source: string; destination: string; permanent: boolean }> {
  const out: Array<{
    source: string;
    destination: string;
    permanent: boolean;
  }> = [];
  for (const [from, to] of Object.entries(table.pages)) {
    if (!from || !to || from === to) continue;
    out.push({ source: `/pages/${from}`, destination: `/pages/${to}`, permanent: true });
    out.push({ source: `/${from}`, destination: `/${to}`, permanent: true });
  }
  for (const [from, to] of Object.entries(table.posts)) {
    if (!from || !to || from === to) continue;
    out.push({
      source: `/blog/${from}`,
      destination: `/blog/${to}`,
      permanent: true,
    });
  }
  return out;
}
