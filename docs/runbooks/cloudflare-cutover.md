# Cloudflare Cutover Runbook (Staging First)

## 1. Scope

- Runtime target: Cloudflare Workers (Workers-first).
- Source of truth: GitHub (`content/filesystem/*`), not Notion.
- Fixed semantics:
  - `Save` writes source branch only.
  - `Deploy` promotes active Worker deployment.

## 2. Required Configuration

- Shared app env:
  - `SITE_ADMIN_STORAGE=github`
  - `GITHUB_APP_ID`
  - `GITHUB_APP_PRIVATE_KEY` (or `GITHUB_APP_PRIVATE_KEY_FILE`)
  - `GITHUB_APP_INSTALLATION_ID`
  - `SITE_ADMIN_REPO_OWNER`
  - `SITE_ADMIN_REPO_NAME`
  - `DEPLOY_TOKEN`
- Cloudflare deploy mode:
  - `DEPLOY_PROVIDER=cloudflare` (recommended)
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN` (Workers Scripts Write)
  - `CLOUDFLARE_WORKER_NAME`
  - optional audit sink:
    - `SITE_ADMIN_AUDIT_D1_DATABASE_ID` (D1 database id for admin audit log)
- Branch binding:
  - staging: `SITE_ADMIN_REPO_BRANCH=site-admin-staging`
  - production: `SITE_ADMIN_REPO_BRANCH=main`

## 2.1 Deployment Discipline (Strict Save/Deploy)

- `Save` only writes source branch via `/api/site-admin/*`.
- `Deploy` only promotes Worker version via `/api/site-admin/deploy` or `npm run deploy:cf:*`.
- Avoid ad-hoc `wrangler deploy` without deployment message metadata.
- Preferred promotion command:
  - `npm run deploy:cf:staging`
  - `npm run deploy:cf:prod`
- Those scripts stamp `workers/message` with `source=<sha> branch=<name>` to keep `pendingDeploy` deterministically computable.

## 3. Staging Setup

1. Ensure source branch `site-admin-staging` exists and is seeded from `main`.
2. Apply staging env vars (especially branch binding + Cloudflare deploy vars).
3. Build Cloudflare artifact:
   - `npm run build:cf`
4. Deploy with env-safe command:
   - `npm run deploy:cf:staging` (script auto-loads `.env` and overrides stale shell values)
5. Open `/api/site-admin/status` and confirm:
   - `source.storeKind=github`
   - `source.branch=site-admin-staging`
   - `env.runtimeProvider=cloudflare` (or expected runtime provider)
   - `source.pendingDeploy=false`

## 4. Staging Smoke

1. Config flow:
   - edit `/site-admin/config` -> Save
   - verify commit appears on `site-admin-staging`
   - verify status shows `pendingDeploy=true`
   - click Deploy and verify `pendingDeploy=false` after rollout
2. Routes flow:
   - save one override + one protected rule
   - verify deploy preview and pending status behavior
3. Concurrency flow:
   - two admins edit same target
   - stale save returns `409 + SOURCE_CONFLICT`
4. Leave guard:
   - refresh/close/internal nav is blocked for unsaved drafts

### Scripted Validation (recommended)

- Read-only admin smoke:
  - `npm run smoke:site-admin`
- Write/deploy + conflict smoke (staging):
  - `npm run smoke:site-admin:write:staging`
  - This executes:
    - settings save (write source)
    - stale save conflict check (`409 + SOURCE_CONFLICT`)
    - restore original value
    - deploy
    - pending deploy convergence check (`true -> false`)

## 5. Production Cutover (Minimal)

1. Set production branch binding to `main`.
2. Run one low-risk config edit and Save.
3. Verify GitHub commit appears, live site unchanged.
4. Verify `pendingDeploy=true`.
5. Trigger Deploy and verify `pendingDeploy=false`.

### Scripted Minimal Verification

- Minimal write/deploy smoke (production):
  - `npm run smoke:site-admin:write:prod`
  - This performs a low-risk save/restore cycle and one deploy, keeping end state unchanged.

## 6. Rollback

1. Find bad source commit on active source branch.
2. Revert commit (`git revert <sha>`).
3. Trigger Deploy.
4. Verify source head and active deployment are aligned.

### Rollback Drill Commands

- Staging drill:
  - `npm run drill:rollback:staging`
- Production drill:
  - `npm run drill:rollback:prod`

Each drill performs:
- `git revert` on source branch
- deploy trigger
- verify status convergence
- `git revert` of the revert (restore)
- deploy trigger + verify convergence again
