# Cloudflare Release Runbook (Local First)

## 1. Scope

- Runtime target: Cloudflare Workers (Workers-first).
- Routine release path: local Cloudflare scripts from the Tauri workspace
  or CLI.
- Staging content source of truth: D1 (`SITE_ADMIN_STORAGE=db`).
- Production content source: bundled `content/*` snapshot generated from
  staging D1 during the production build.
- Fixed semantics:
  - `Save` writes staging D1.
  - `Release staging` builds and deploys the staging Worker locally.
  - `Promote production` builds from staging D1 and deploys production
    locally.
  - GitHub Actions `release-from-dispatch.yml` is fallback only.

## 2. Required Configuration

- Shared app env:
  - staging Worker: `SITE_ADMIN_STORAGE=db`
  - production Worker: `SITE_ADMIN_STORAGE=local`
  - `DEPLOY_TOKEN`
- Cloudflare deploy mode:
  - `DEPLOY_PROVIDER=cloudflare` (recommended)
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN` (Workers Scripts Write)
  - `CLOUDFLARE_WORKER_NAME`
  - `CLOUDFLARE_WORKER_NAME_STAGING`
  - `CLOUDFLARE_WORKER_NAME_PRODUCTION`
- Optional GitHub fallback:
  - `SITE_ADMIN_REPO_OWNER`
  - `SITE_ADMIN_REPO_NAME`
  - GitHub App secrets only if dispatch fallback is enabled.

## 2.1 Deployment Discipline (Strict Save/Deploy)

- `Save` writes D1 through `/api/site-admin/*`.
- `Deploy` uses local Cloudflare scripts by default:
  - `npm run release:staging`
  - `npm run release:prod:from-staging`
- Avoid ad-hoc `wrangler deploy` without deployment message metadata.
- Staging releases may run from a dirty non-content worktree; the script
  builds a clean snapshot of committed HEAD. Dirty `content/` still blocks
  by default because the D1 dump would overwrite it.
- Release scripts stamp `workers/message` with
  `source=<sha> branch=<name> code=<sha> content=<sha> contentBranch=<name>`
  to keep status/preflight deterministic.

## 3. Staging Setup

1. Apply staging env vars and D1 binding.
2. Build and deploy staging from the local checkout:
   - `npm run release:staging`
3. Open `/api/site-admin/status` and confirm:
   - `source.storeKind=db` with `source.repo=d1:SITE_ADMIN_DB`
   - `source.deployableVersionReady=true`
   - `env.runtimeProvider=cloudflare` (or expected runtime provider)
   - `source.pendingDeploy=null` for DB-backed content

## 4. Staging Smoke

1. Config flow:
   - edit content from the workspace -> Save
   - verify staging D1 reflects the change
   - run `npm run release:staging`
   - verify staging public route reflects the change
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

## 5. Production Promotion (Minimal)

1. Verify staging has the desired content.
2. Run `npm run release:prod:from-staging:dry-run`.
3. Run `npm run release:prod:from-staging`.
4. Verify production routes and `/api/site-admin/status`.

### Scripted Minimal Verification

- Production smoke:
  - `npm run verify:cf:prod`
  - `curl -sS -o /dev/null -w '%{http_code}\n' https://jinkunchen.com/`
  - `curl -sS -o /dev/null -w '%{http_code}\n' https://jinkunchen.com/blog`

## 6. Rollback

1. Find the last good Worker version in Cloudflare or
   `production-version-history.md`.
2. Re-deploy that version or revert the code/content commit.
3. Run the matching local release command.
4. Verify source metadata and active deployment are aligned.
