## Getting Started (Local)

```bash
npm run dev
```

## Vercel CLI Upload Scope

Local `vercel deploy` / `vercel --prod` now uses `.vercelignore` to exclude local caches and debug artifacts (for example `.next`, `node_modules`, `output`, `.playwright-cli`, `tests`) to reduce upload size and speed up deploys.

## Content-Backed Site

This repo compiles a configured content source into static artifacts under `content/generated/`, which the Next.js runtime consumes.

Supported content sources:

- `filesystem`: repo-local source files under `content/filesystem/`
- `notion`: the legacy Notion-backed adapter

`npm run sync:content` chooses the source in this order:

- `CONTENT_SOURCE` when explicitly set
- `notion` when both `NOTION_TOKEN` and `NOTION_SITE_ADMIN_PAGE_ID` are configured
- `filesystem` otherwise

### Filesystem Source (Recommended)

Repo-local content lives under:

- `content/filesystem/site-config.json`
- `content/filesystem/routes-manifest.json`
- `content/filesystem/protected-routes.json`
- `content/filesystem/raw/**/*.html`
- `content/filesystem/pages/**/*.mdx`

Use this mode when you want the site to build without live Notion access. Raw HTML keeps the current Super/Notion DOM stable, while MDX pages are available for incremental migration.

Sync it with:

```bash
npm run sync:content
```

### Site Admin Storage

`/site-admin` now supports two storage backends for structured edits:

- `SITE_ADMIN_STORAGE=local`: local development / tests. Saves update repo files under `content/filesystem/*`.
- `SITE_ADMIN_STORAGE=github`: production-safe mode. Saves commit directly to `SITE_ADMIN_REPO_BRANCH` via GitHub App Contents API.

When using GitHub storage, Save and Deploy are intentionally separate:

- `Save`: persists source files to GitHub
- `Deploy`: triggers the Vercel deploy hook

Required env for GitHub storage:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_INSTALLATION_ID`
- `SITE_ADMIN_REPO_OWNER`
- `SITE_ADMIN_REPO_NAME`
- `SITE_ADMIN_REPO_BRANCH` (default `main`)

The admin API uses optimistic concurrency against GitHub file SHAs. If another admin saves first, the later save returns `409 SOURCE_CONFLICT` and the UI should refresh.

#### Production Rollout Checklist

For the current v1 model (`Save = write to main`, `Deploy = publish later`), keep production setup aligned with these rules:

- Grant the GitHub App only `Repository metadata: read-only` and `Contents: read/write`.
- Set `SITE_ADMIN_STORAGE=github` in Vercel for the production environment.
- Point `SITE_ADMIN_REPO_OWNER`, `SITE_ADMIN_REPO_NAME`, and `SITE_ADMIN_REPO_BRANCH` at the exact repo/branch that Vercel builds from.
- Disable any automatic production deploy triggered by `main` pushes. Production release should happen only from `/site-admin` Deploy or the signed deploy hook.
- Treat rollback as two steps: `git revert` the saved source commit on `main`, then trigger a fresh Deploy.
- Before flipping production traffic, run one smoke check with real production credentials and confirm:
  - Save creates a GitHub commit without changing the live site immediately.
  - `/site-admin` status reports `pendingDeploy=true`.
  - Deploy publishes the saved source and status returns to `pendingDeploy=false`.

#### Staging-First Rollout

This repo now includes:

- [`vercel.json`](/Users/jinnkunn/Desktop/jinnkunn.com/vercel.json), which disables automatic Git-triggered deploys for `main` and `site-admin-staging`
- `npm run audit:site-admin`, which audits a Vercel project, source branch, deploy hook presence, and required env names
- [`docs/site-admin-rollout.md`](/Users/jinnkunn/Desktop/jinnkunn.com/docs/site-admin-rollout.md), which captures the staging-first setup, smoke run, production cutover, and rollback flow

Staging audit example:

```bash
npm run audit:site-admin -- \
  --project jinnkunn-com-staging \
  --scope jinnkunns-projects \
  --branch site-admin-staging \
  --repo-owner Jinnkunn \
  --repo-name jinnkunn.com
```

Production audit example:

```bash
npm run audit:site-admin -- \
  --project jinnkunn-com \
  --scope jinnkunns-projects \
  --branch main \
  --repo-owner Jinnkunn \
  --repo-name jinnkunn.com
```

Vercel currently documents deploy hook creation from the project Git settings page. The audit command will fail until the matching branch hook and env are present.

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
    "favicon": "/assets/favicon.png",
    "ogImage": "/assets/profile.png"
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
    "homePageId": null,
    "sitemapAutoExclude": {
      "enabled": true,
      "excludeSections": [],
      "maxDepthBySection": { "teaching": 5 }
    }
  }
}
```

#### Optional: Provision Databases (Recommended)

To make the `Site Admin` page feel like a real backend, you can provision 3 inline databases:

- `Site Settings` (site name, SEO, sitemap policy, content root/home page id)
- `Navigation` (top nav + More dropdown)
- `Route Overrides` (optional pageId -> route mapping)

If these databases exist, the Notion adapter will prefer them over the JSON code block.

To auto-create and seed them from the existing JSON config:

```bash
npm run provision:admin
```

### 2) Notion Integration + Env Vars

- Create a Notion internal integration, copy its secret token.
- Share the `Site Admin` page with that integration.
- Set env vars (see `.env.example` if present, otherwise use the list below).

Required for the Notion adapter:
- `NOTION_TOKEN`
- `NOTION_SITE_ADMIN_PAGE_ID`

Required for `/site-admin` GitHub login:
- `GITHUB_ID`
- `GITHUB_SECRET`
- `NEXTAUTH_SECRET` (or `AUTH_SECRET`)
- `SITE_ADMIN_GITHUB_USERS` (comma-separated GitHub usernames, e.g. `jinnkunn,@someone`)

Required for Vercel Flags SDK:
- `FLAGS_SECRET` (32-byte base64url secret, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`)

Optional:
- `CONTENT_GITHUB_USERS` (allowlist for viewing protected content)
- `VERCEL_DEPLOY_HOOK_URL` + `DEPLOY_TOKEN` (for signed deploy API / Site Admin deploy)
- `DEPLOY_HOOK_TIMEOUT_MS` (default `10000`)
- `DEPLOY_HOOK_MAX_ATTEMPTS` (default `3`)
- `DEPLOY_HOOK_RETRY_BASE_DELAY_MS` (default `350`)

GitHub Actions (`CI`, `UI Smoke`, `UI Compare`, `Search Snapshots`, `Production Quality`) read:
- `FLAGS_SECRET` from repo/org secret `FLAGS_SECRET`
- `NEXTAUTH_SECRET` from secret `NEXTAUTH_SECRET` (if missing, workflow auto-generates an ephemeral CI-only value)

### 3) Sync

```bash
npm run sync:content
```

This generates:
- `content/generated/site-config.json`
- `content/generated/raw/<route>.html`

`npm run build` will run content sync automatically via `prebuild` when either:

- a filesystem source exists under `content/filesystem/`, or
- the Notion adapter is configured

If you specifically want the legacy Notion-only command, `npm run sync:notion` is still available.

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

Outputs go to `output/playwright/compare/<timestamp>/` and include:
- `orig__*.png` / `clone__*.png`
- `diff__*.png` (pixel diff image)
- `summary.json` (per-page diff percent + gate result)

Diff gate env vars:

```bash
SNAPSHOT_COMPARE_MAX_DIFF_PERCENT=8 SNAPSHOT_COMPARE_FAIL_ON_DIFF=1 npm run snapshot:compare
```

## UI Smoke Checks

Quick end-to-end checks for critical interactions (nav, mobile menu, toggles, code copy, lightbox, embeds):

```bash
npm run smoke:ui
```

Outputs go to `output/ui-smoke/<timestamp>/` and `output/ui-smoke/latest.json`.

Quick profile (for CI / PR gate):

```bash
SMOKE_UI_QUICK=1 SMOKE_UI_SKIP_BUILD=1 npm run smoke:ui
```

## Production Smoke Checks

Run browser smoke checks directly against production origin:

```bash
npm run smoke:prod
```

Optional overrides:

```bash
SMOKE_PROD_ORIGIN="https://jinkunchen.com" npm run smoke:prod
SMOKE_PROD_QUERY="reasoning" npm run smoke:prod
```

Outputs go to `output/ui-smoke-prod/<timestamp>/` and `output/ui-smoke-prod/latest.json`.

## Production Quality Checks (Sitemap / Canonical / Internal Links)

Run non-UI production checks directly against your deployed origin:

```bash
npm run check:quality:prod
```

Optional overrides:

```bash
QUALITY_PROD_ORIGIN="https://jinkunchen.com" npm run check:quality:prod
QUALITY_PROD_MAX_PAGES=160 QUALITY_PROD_MAX_LINKS_PER_PAGE=50 npm run check:quality:prod
```

Outputs go to `output/quality-prod/<timestamp>/report.json` and `output/quality-prod/latest.json`.

## Accessibility Checks (Axe)

Run automated accessibility checks (WCAG 2A/2AA).

Default behavior:

- discovers routes from `sitemap.xml` + section sitemaps,
- keeps priority routes (`/`, `/blog`, `/publications`),
- then round-robin samples across sections (default max: 12 pages).

Exit code policy: serious/critical issues on priority routes fail the command; sampled routes are report-only unless `A11Y_FAIL_ALL=1`.

```bash
npm run check:a11y
```

Common overrides:

```bash
# CI profile (skip rebuild, run against already-built app)
A11Y_SKIP_BUILD=1 npm run check:a11y

# cap scanned page count
A11Y_MAX_PAGES=16 npm run check:a11y

# force explicit paths (skip sitemap discovery)
A11Y_PATHS="/,/blog,/publications,/works" npm run check:a11y

# fail on all audited pages (default only blocks on priority/core pages)
A11Y_FAIL_ALL=1 npm run check:a11y

# full-site mode (audit all sitemap URLs; all are blocking)
A11Y_FULL_SITE=1 A11Y_FAIL_ALL=1 npm run check:a11y
```

Outputs go to `output/a11y/<timestamp>/report.json` and `output/a11y/latest.json`.

## Performance Budget Checks (LCP / CLS / INP)

Run lab performance budget checks for core pages:

```bash
npm run check:perf
```

Common overrides:

```bash
PERF_PATHS="/,/blog,/publications,/works" npm run check:perf
PERF_BUDGET_LCP_MS=4500 PERF_BUDGET_CLS=0.12 PERF_BUDGET_INP_MS=300 npm run check:perf
PERF_SKIP_BUILD=1 npm run check:perf
```

Outputs go to `output/perf/<timestamp>/report.json` and `output/perf/latest.json`.

CI currently runs with `A11Y_FAIL_ALL=1` (the sampled audited pages are blocking).

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

- `CI`: `npm ci` + `check:scripts` + `build` + `test` + **quick UI smoke** + **full-site axe a11y checks** + **performance budgets**.
- `UI Smoke`: manual only (workflow_dispatch). Sync raw HTML from the live site + run E2E smoke checks.
- `Production Quality`: manual only (workflow_dispatch). Runs Playwright smoke checks + sitemap/canonical/internal-link quality checks on the production origin.
- `UI Compare`: manual, captures screenshots from orig vs clone.
- `Search Snapshots`: manual, captures search overlay screenshots from a deployment.
