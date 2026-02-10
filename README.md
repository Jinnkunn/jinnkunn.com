## Getting Started (Local)

```bash
npm run dev
```

## Notion-Backed Site (Super-Like)

This repo can compile a Notion page tree into a static Next.js site.

### 1) Create Notion "Site Admin" Page

- Create a Notion page (e.g. `Site Admin`).
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
- `VERCEL_DEPLOY_HOOK_URL` + `DEPLOY_TOKEN` (for Notion deploy button)

### 3) Sync

```bash
npm run sync:notion
```

This generates:
- `content/generated/site-config.json`
- `content/generated/raw/<route>.html`

`npm run build` will run Notion sync automatically via `prebuild` when `NOTION_*` env vars are set.

## Deploy Button (Notion -> Vercel)

The site exposes `/api/deploy?token=...` which triggers a Vercel Deploy Hook.

Required env:
- `DEPLOY_TOKEN`
- `VERCEL_DEPLOY_HOOK_URL`

In Notion, create a button or link pointing to:

`https://<your-site-domain>/api/deploy?token=<DEPLOY_TOKEN>`

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
- `UI Smoke`: sync raw HTML from the live site + run E2E smoke checks.
- `UI Compare`: manual, captures screenshots from orig vs clone.
- `Search Snapshots`: manual, captures search overlay screenshots from a deployment.
