# Site Admin Rollout

This repo now supports the `Save = write source branch` and `Deploy = publish later` workflow for `/site-admin`.

The repo-level deployment guard lives in [`/Users/jinnkunn/Desktop/jinnkunn.com/vercel.json`](/Users/jinnkunn/Desktop/jinnkunn.com/vercel.json): both `main` and `site-admin-staging` have `git.deploymentEnabled=false`, so branch pushes no longer auto-publish either environment.

## Current branch mapping

- Staging source branch: `site-admin-staging`
- Production source branch: `main`
- Staging Vercel project: `jinnkunn-com-staging`
- Production Vercel project: `jinnkunn-com`

## Required permissions

The GitHub App used by `SITE_ADMIN_STORAGE=github` should have only:

- `Repository metadata: read-only`
- `Contents: read/write`

## Required Vercel env

Each project needs these env vars in its production target:

- `SITE_ADMIN_STORAGE=github`
- `SITE_ADMIN_REPO_OWNER=Jinnkunn`
- `SITE_ADMIN_REPO_NAME=jinnkunn.com`
- `SITE_ADMIN_REPO_BRANCH`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_INSTALLATION_ID`
- `GITHUB_ID`
- `GITHUB_SECRET`
- `NEXTAUTH_SECRET`
- `SITE_ADMIN_GITHUB_USERS`
- `VERCEL_DEPLOY_HOOK_URL`
- `DEPLOY_TOKEN`

Use:

```bash
npm run audit:site-admin -- \
  --project jinnkunn-com-staging \
  --scope jinnkunns-projects \
  --branch site-admin-staging \
  --repo-owner Jinnkunn \
  --repo-name jinnkunn.com
```

and:

```bash
npm run audit:site-admin -- \
  --project jinnkunn-com \
  --scope jinnkunns-projects \
  --branch main \
  --repo-owner Jinnkunn \
  --repo-name jinnkunn.com
```

The audit checks:

- remote source branch exists on `origin`
- Vercel project is linked to the expected repo
- Next.js preset is enabled
- a deploy hook exists for the source branch
- local `vercel.json` disables automatic Git deployments for `main` and `site-admin-staging`
- required env vars exist
- `SITE_ADMIN_STORAGE`, `SITE_ADMIN_REPO_OWNER`, `SITE_ADMIN_REPO_NAME`, and `SITE_ADMIN_REPO_BRANCH` match the expected rollout target

## Staging setup

1. Create the source branch if it does not exist:

```bash
git push origin main:site-admin-staging
```

2. Create the staging Vercel project and connect the same GitHub repo.
3. Set staging project env:
   - `SITE_ADMIN_STORAGE=github`
   - `SITE_ADMIN_REPO_OWNER=Jinnkunn`
   - `SITE_ADMIN_REPO_NAME=jinnkunn.com`
   - `SITE_ADMIN_REPO_BRANCH=site-admin-staging`
   - copy the shared auth env from production
   - add the GitHub App env for source writes
4. In Vercel Settings -> Git, create one deploy hook for `site-admin-staging`.
   - Vercel's current docs still route deploy hook creation through the project Git settings UI.
   - Set `VERCEL_DEPLOY_HOOK_URL` in the staging project to that hook URL.
5. Run the audit command above until it returns `0 fail`.

## Staging smoke run

1. Open `/site-admin/config` on staging.
2. Modify a low-risk field and click `Save`.
3. Confirm a commit lands on `site-admin-staging`.
4. Confirm the live staging page does not change immediately.
5. Confirm `/site-admin` shows `pendingDeploy=true`.
6. Click `Deploy`.
7. After the deployment finishes, refresh status and confirm `pendingDeploy=false`.
8. Repeat once in `/site-admin/routes`:
   - add or edit a route override
   - edit one protected route
   - verify deploy preview changes before deploy
9. Validate conflict handling:
   - open the same record twice
   - save from tab A, then save from tab B
   - tab B must receive `SOURCE_CONFLICT`
10. Validate unsaved-navigation protection:
   - refresh
   - close the tab
   - move between `/site-admin`, `/site-admin/config`, and `/site-admin/routes`
11. Validate source error handling:
   - temporarily remove one GitHub App env from staging
   - confirm `/site-admin/status` exposes the source error
   - restore the env and confirm recovery

## Production cutover

Only do this after the full staging smoke run passes.

1. Set production env:
   - `SITE_ADMIN_STORAGE=github`
   - `SITE_ADMIN_REPO_OWNER=Jinnkunn`
   - `SITE_ADMIN_REPO_NAME=jinnkunn.com`
   - `SITE_ADMIN_REPO_BRANCH=main`
   - GitHub App env
   - existing GitHub login env
   - `VERCEL_DEPLOY_HOOK_URL` for the `main` deploy hook
   - `DEPLOY_TOKEN`
2. Re-run the production audit until it returns `0 fail`.
3. Run one minimal production validation:
   - save a low-risk config change
   - verify a commit lands on `main`
   - verify the public site does not change immediately
   - confirm `/site-admin/status` reports `pendingDeploy=true`
   - click `Deploy`
   - confirm `pendingDeploy=false` after the deploy catches up

## Rollback

Rollback remains two-step:

1. Revert the bad source commit on the affected branch.

```bash
git checkout main
git revert <bad-commit-sha>
git push origin main
```

Or for staging:

```bash
git checkout site-admin-staging
git revert <bad-commit-sha>
git push origin site-admin-staging
```

2. Trigger one manual `Deploy` from `/site-admin`, or call the matching deploy hook URL.

## Notes

- `git.deploymentEnabled=false` is the supported way to disable automatic Git-triggered deployments per branch while keeping deploy hooks available.
- Do not use `github.enabled=false`; Vercel documents that deploy hooks will not fire when that legacy setting is present.
