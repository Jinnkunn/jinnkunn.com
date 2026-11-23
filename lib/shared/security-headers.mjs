// Baseline response hardening, shared by every layer that can answer a request:
//
// - next.config.mjs `headers()` — responses rendered by the OpenNext runtime;
// - the Cloudflare `_headers` file written by
//   scripts/build/export-static-shell-assets.mjs — responses from the asset
//   server, including those read through `env.ASSETS.fetch()`;
// - cloudflare/worker-entry.mjs — responses the Worker builds itself (static
//   shells, D1 overlays, edge 403/404/503s). Production public HTML comes from
//   here, so none of the other two layers ever touch it.
//
// `interest-cohort` is deliberately absent from Permissions-Policy: FLoC was
// withdrawn and Chrome logs a console error for the unrecognised feature.
export const BASELINE_SECURITY_HEADERS = Object.freeze([
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"],
  ["X-Frame-Options", "SAMEORIGIN"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
]);

/**
 * Returns `response` with any missing baseline header added. Headers the
 * response already carries win (a route that sends `X-Frame-Options: DENY`
 * keeps it), and a response that needs nothing is returned untouched.
 * A copy is made otherwise, because responses from `fetch()`/`env.ASSETS.fetch()`
 * and `Response.redirect()` have immutable headers.
 */
export function withBaselineSecurityHeaders(response) {
  const missing = BASELINE_SECURITY_HEADERS.filter(([name]) => !response.headers.has(name));
  if (missing.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of missing) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
