# Site Admin GitHub Storage Runbook (Staging First)

## Scope

- Applies to Site Admin v1 (`Save = write source branch`, `Deploy = publish`).
- Uses `SITE_ADMIN_STORAGE=github`.
- Keeps optimistic concurrency (`409 + SOURCE_CONFLICT`) and no auto-merge.

## 1. Prerequisites

- GitHub App permissions:
  - `Repository metadata: Read-only`
  - `Contents: Read and write`
- Repo branches:
  - staging source: `site-admin-staging`
  - production source: `main`
- Deployment behavior:
  - disable auto deploy on branch push for both staging and production
  - deploy must be manual from `/site-admin` Deploy action (or deploy hook)

## 2. Required Environment Variables

- Shared:
  - `SITE_ADMIN_STORAGE=github`
  - `GITHUB_APP_ID`
  - `GITHUB_APP_PRIVATE_KEY` (or `GITHUB_APP_PRIVATE_KEY_FILE`)
  - `GITHUB_APP_INSTALLATION_ID`
  - `SITE_ADMIN_REPO_OWNER`
  - `SITE_ADMIN_REPO_NAME`
  - `DEPLOY_TOKEN`
  - optional desktop-app token signer:
    - `SITE_ADMIN_APP_TOKEN_SECRET` (falls back to `NEXTAUTH_SECRET`/`AUTH_SECRET` if omitted)
  - deploy target:
    - `DEPLOY_HOOK_URL` (primary hook mode), or
    - `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_WORKER_NAME`
  - optional compatibility fallback: `VERCEL_DEPLOY_HOOK_URL`
  - optional admin audit sink:
    - `SITE_ADMIN_AUDIT_D1_DATABASE_ID` (with `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`)
- Branch binding:
  - staging: `SITE_ADMIN_REPO_BRANCH=site-admin-staging`
  - production: `SITE_ADMIN_REPO_BRANCH=main`

## 3. Staging Setup

1. Create `site-admin-staging` if missing and seed from `main` `content/filesystem/*`.
2. Configure staging project env using the staging branch binding above.
3. Deploy staging and open `/api/site-admin/status`.
4. Confirm:
   - `source.storeKind = github`
   - `source.repo = <owner>/<repo>`
   - `source.branch = site-admin-staging`
   - `source.pendingDeploy = false`

## 4. Staging Smoke Run

### 4.1 Config Save/Deploy

1. Open `/site-admin/config`.
2. Edit one low-risk field (for example `siteName`) and click Save.
3. Verify GitHub commit appears on `site-admin-staging`.
4. Verify public staging page does not change immediately.
5. Verify `/site-admin` shows `pendingDeploy = true`.
6. Click Deploy.
7. After deployment, refresh status and verify `pendingDeploy = false`.

### 4.2 Routes Save/Deploy

1. Add one route override and save.
2. Update one protected route and save.
3. Verify both writes create commits on `site-admin-staging`.
4. Verify deploy preview/status reflect pending source changes.
5. Deploy and verify behavior after deploy is correct.

### 4.3 Conflict + Unsaved Guard

1. Open same config/route in two admin sessions.
2. Save from session A, then save stale draft from session B.
3. Verify session B receives `SOURCE_CONFLICT` and must reload.
4. Verify unsaved leave guard works for refresh/close/internal nav.

### 4.4 Failure Probe

1. Remove one GitHub env in staging (for example `GITHUB_APP_INSTALLATION_ID`).
2. Verify `/api/site-admin/status` shows `source.error`.
3. Restore env and verify status recovers.

## 5. Production Cutover (Minimal)

Do this only after full staging pass.

1. Set production env with same GitHub App secrets.
2. Set `SITE_ADMIN_REPO_BRANCH=main`.
3. Confirm production auto-deploy-on-push is disabled.
4. Perform one minimal low-risk edit in `/site-admin/config`, Save.
5. Confirm commit appears on `main`, but live site is unchanged.
6. Confirm status shows `pendingDeploy = true`.
7. Click Deploy.
8. Confirm post-deploy `pendingDeploy = false`.

## 6. Rollback

1. Identify bad source commit on active source branch.
2. `git revert <commit>` on that source branch.
3. Trigger Deploy from Site Admin.
4. Verify source head and deployed commit are aligned.

## 7. Operational Rules

- Save never triggers Deploy.
- Deploy never persists unsaved editor draft.
- Conflict handling is always reload-latest then reapply edits.
- Desktop app auth should use browser flow endpoint:
  - `GET /api/site-admin/app-auth/authorize?redirect_uri=http://127.0.0.1:<port>/callback&state=<nonce>`
- For v1, do not introduce PR flow/content branches for normal admin writes.
- Admin write/deploy/conflict events should be observable via D1 audit log when configured.
