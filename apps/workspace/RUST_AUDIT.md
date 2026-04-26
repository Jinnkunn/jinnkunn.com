# Tauri Rust audit

Snapshot of `apps/workspace/src-tauri/src/main.rs` (501 lines) and a
deliberate answer to "should we move more code from the React side
into Rust?" The TL;DR is **no**, with the qualifier that two specific
features could land in Rust later if their adjacent React code starts
to feel like it's fighting the boundary.

## What's in Rust today

| Area | Rust LOC | Why it lives in Rust |
|-|-|-|
| `site_admin_http_request` (HTTP client + CF Access service token, JSON / non-JSON response handling) | ~110 | Tauri webviews can't make cross-origin requests with the right CF Access headers from the JS side without CORS preflight pain; pushing the request to Rust avoids CORS entirely and centralizes header construction (Bearer / cookie / `cf-access-client-id` / `cf-access-client-secret`). |
| `secure_store_{set,get,delete}` (OS keyring via `keyring` crate) | ~45 | Only path to the macOS Keychain / Windows Credential Manager / Linux secret-service from a Tauri app. Cannot be done in JS. |
| `site_admin_browser_login` (loopback OAuth-ish callback flow) | ~95 | Spins up a `127.0.0.1:0` listener and waits for the browser-redirect callback — needs raw TCP. Couldn't be done in the webview without leaking the in-progress token to whatever page intercepts the redirect. |
| macOS chrome (`apply_vibrancy`, `set_traffic_lights_inset`, decorum overlay titlebar, window-state persistence) | ~80 | macOS-only platform integrations exposed by tauri plugins (`decorum`, `window-vibrancy`, `window-state`). Not reachable from JS. |
| Tauri plugin glue (updater, window-state plugin init) | ~10 | Tauri plumbing. |

Total: ~340 LOC of "actually doing things" + ~160 LOC of struct
definitions, type conversions, and main(). Every line is justified by
"this can only be done from Rust."

## What's NOT in Rust (and shouldn't move)

- **API endpoint dispatching, request-shape construction, response
  normalization** — all on the React side (`siteAdminRequest` →
  `useSiteAdmin().request`). Moving any of this to Rust would mean
  every API call hits the IPC bridge twice (JS → Rust → server →
  Rust → JS) instead of once (JS → Rust → server → JS). The single
  IPC hop is already there for the CORS reason; doubling it for
  business logic that's pure JSON shaping would only add latency.
- **MDX block parsing / serialization (`mdx-blocks.ts`)** — pure
  string transforms. The block editor calls these on every keystroke
  to round-trip the document; an IPC boundary on every keystroke
  would tank typing latency. Plus the same code runs on the public
  Next.js site (lib re-exports), so duplicating in Rust would fork
  the source of truth.
- **Slug / URL / SEO override normalization (`lib/site-admin/*-normalize.ts`,
  `lib/shared/seo-page-overrides.ts`)** — same reason. These run on
  both client (admin UI) and server (the Cloudflare Worker handling
  `/api/site-admin/*`). Moving to Rust forks the contract.
- **Editor state, draft persistence, undo/redo, selection
  bookkeeping** — react state. Has no Rust analogue worth porting.
- **Settings / Routes panel, command palette, sidebar nav,
  block-editor canvas** — all UI. Belongs in React.

## Maybe-move candidates (none urgent)

These are the only places where Rust would arguably help, listed in
descending order of plausibility. None are currently bottlenecked.

1. **Local file-based search index for the command palette.** Today
   the palette searches in-memory over the post/page list state
   already loaded by `state.ts`. If the workspace ever caches content
   to disk (e.g. for offline editing) and we want fuzzy ranking over
   thousands of files, a Rust-side ripgrep/tantivy index would beat
   doing it in JS. Not needed at current scale.

2. **Image upload pipeline.** `lib/server/site-admin-uploads.ts`
   handles asset uploads via the API. The Rust side could pre-process
   images (resize, generate WebP/AVIF variants) before posting to the
   Worker, saving bandwidth on slow connections. Marginal gain;
   Cloudflare Images at the edge does this better anyway. Skip.

3. **Cron-style background sync** (e.g. periodic notion-syncMeta poll
   for the Status panel). Currently each panel pulls its own data on
   mount. A Rust background task could push changes via a Tauri
   event. Not worth it for a personal-scale admin app.

## What's missing from Rust that I'd want eventually

These are gaps where the *current* Rust does too little, not where
Rust should grow into JS territory:

- **No update-channel pinning.** `tauri_plugin_updater` is included
  but `tauri.conf.json`'s `plugins.updater.pubkey` is empty (per the
  comment in `main.rs:430`), so the updater is a no-op. To ship
  signed self-updates, wire `release.yml` (already referenced in the
  comment) and fill the pubkey.

- **No structured logging / error reporting.** Rust commands return
  `Result<T, String>` and the React side prints them. No panic hook
  routes to a crash reporter; no breadcrumb trail to debug a
  user-reported bug. Low priority for a personal tool.

- **`debug_set_traffic_lights` is a dev-only command but ships in
  release builds.** `cfg(target_os = "macos")` gates it but
  `debug_assertions` doesn't. Worth gating with `#[cfg(debug_assertions)]`
  if we ever ship signed builds publicly.

## Verdict

**Don't refactor.** The Rust side is doing exactly what Rust is good
at: keychain, native window chrome, an HTTP shim that bypasses CORS
and centralizes auth-header construction, and a TCP loopback for the
browser sign-in callback. Every line that *isn't* in Rust today has
either a "must run on the public site too" reason (parsing /
normalization) or a "would add IPC overhead with zero benefit" reason
(everything else).

If anything, **the React side is now closer to being right-sized
than the Rust side**, after the recent Home cleanup (~5300 lines
deleted in one PR). The next worthwhile invest in this codebase is
content / UX, not where to draw the JS↔Rust line.
