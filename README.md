## Getting Started (Local)

```bash
npm run dev
```

## Content-Backed Site (Super-Like)

This repo can compile a page tree (via the configured content source) into a static Next.js site.

### 1) Create "Site Admin" Page

- Create a page (e.g. `Site Admin`).
- Under it, create child pages (these become site pages, recursive).
- Add a **Code** block (language: `json`) containing site config (legacy/advanced). Example:

```json
{
  "siteName": "Jinkun Chen.",
  "lang": "en",
  "seo": {
    "title": "Jinkun Chen",
    "description": "Personal site.",
    "favicon": "/assets/favicon.png"
  },
  "nav": {
    "top": [
      { "href": "/", "label": "Home" },
      { "href": "/publications", "label": "Publications" }
    ],
    "more": [{ "href": "/blog", "label": "Blog" }]
  },
  "content": {
    "rootPageId": null,
    "homePageId": null
  }
}
```

#### Optional: Provision Databases (Recommended)

To make the `Site Admin` page feel like a real backend, you can provision 3 inline databases:

- `Site Settings` (site name, SEO, content root/home page id)
- `Navigation` (top nav + More dropdown)
- `Route Overrides` (optional pageId -> route mapping)

If these databases exist, `npm run sync:notion` will prefer them over the JSON code block.

To auto-create and seed them from the existing JSON config:

```bash
npm run provision:admin
```

### 2) Notion Integration + Env Vars

- Create a Notion internal integration, copy its secret token.
- Share the `Site Admin` page with that integration.
- Set env vars (see `.env.example` if present, otherwise use the list below).

Required for Notion sync:
- `NOTION_TOKEN`
- `NOTION_SITE_ADMIN_PAGE_ID`

Required for `/site-admin` GitHub login:
- `GITHUB_ID`
- `GITHUB_SECRET`
- `NEXTAUTH_SECRET` (or `AUTH_SECRET`)
- `SITE_ADMIN_GITHUB_USERS` (comma-separated GitHub usernames, e.g. `jinnkunn,@someone`)

Optional:
- `CONTENT_GITHUB_USERS` (allowlist for viewing protected content)
- `VERCEL_DEPLOY_HOOK_URL` + `DEPLOY_TOKEN` (for signed deploy API / Site Admin deploy)

### 3) Sync

```bash
npm run sync:notion
```

This generates:
- `content/generated/site-config.json`
- `content/generated/raw/<route>.html`

`npm run build` will run Notion sync automatically via `prebuild` when `NOTION_*` env vars are set.

## Deploy API (Signed POST)

The site exposes `/api/deploy` and accepts only signed `POST` requests.

Required env:
- `DEPLOY_TOKEN`
- `VERCEL_DEPLOY_HOOK_URL`

Headers required:
- `x-deploy-ts`: unix timestamp (seconds or milliseconds)
- `x-deploy-signature`: `sha256=<hex(hmac_sha256(DEPLOY_TOKEN, "${x-deploy-ts}.${rawBody}"))>`

Example:

```bash
TS="$(date +%s)"
BODY='{}'
SIG="$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$DEPLOY_TOKEN" -hex | sed 's/^.* //')"
curl -X POST "https://<your-site-domain>/api/deploy" \
  -H "content-type: application/json" \
  -H "x-deploy-ts: $TS" \
  -H "x-deploy-signature: sha256=$SIG" \
  --data "$BODY"
```

`/site-admin` 页面里的 Deploy 按钮已使用服务端安全调用，无需手工签名。

## Site Admin Status

The admin UI includes a quick sanity-check page:

- `/site-admin/status`

It shows key build info, content sync metadata, search index stats, and a best-effort freshness indicator.

## Legacy Content Sync (Clone Mode)

This repo can also sync hydrated HTML from an existing Super site into `content/raw/`:

```bash
npm run sync:raw
```

## UI Regression Snapshots

```bash
npm run snapshot:ui
```

Outputs go to `output/ui-snapshots/<timestamp>/`.

## Script Syntax Check (.mjs)

To prevent Vercel/GitHub CI failures caused by accidentally adding TypeScript syntax to `.mjs` files:

```bash
npm run check:scripts
```

This is also run in GitHub Actions `CI`.

## Search Regression Snapshots (Production)

```bash
CLONE_ORIGIN="https://your-deployment.vercel.app" npm run snapshot:search
```

Outputs go to `output/playwright/search/<timestamp>/`.

## Orig vs Clone Compare Screenshots

```bash
ORIG_ORIGIN="https://jinkunchen.com" CLONE_ORIGIN="https://your-deployment.vercel.app" npm run snapshot:compare
```

Outputs go to `output/playwright/compare/<timestamp>/`.

## UI Smoke Checks

Quick end-to-end checks for critical interactions (nav, mobile menu, toggles, code copy, lightbox, embeds):

```bash
npm run smoke:ui
```

Outputs go to `output/ui-smoke/<timestamp>/` and `output/ui-smoke/latest.json`.

## One-Command Verification

Run the full pipeline:

- sync raw HTML from the live site
- audit Notion/Super blocks in use
- run UI smoke checks
- generate UI snapshots

```bash
npm run check:ui
```

To skip syncing (offline / only validate current local content):

```bash
SKIP_SYNC=1 npm run check:ui
```

## Notion Block Audit

This scans the current raw HTML and lists all `notion-*` and `super-*` classes in use. This is how we
know which Notion/Super block styles we must support.

```bash
npm run audit:notion
```

Outputs go to `output/notion-block-audit/<timestamp>/` and `output/notion-block-audit/latest.*`.

## GitHub Actions

- `CI`: basic `npm ci` + `npm run build` (works without Notion secrets).
- `UI Smoke`: manual only (workflow_dispatch). Sync raw HTML from the live site + run E2E smoke checks.
- `UI Compare`: manual, captures screenshots from orig vs clone.
- `Search Snapshots`: manual, captures search overlay screenshots from a deployment.
