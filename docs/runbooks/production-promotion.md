# Production Promotion Runbook

## Scope

Use this runbook when promoting the current `main` release candidate to the
Cloudflare production Worker.

Current protected production baseline:

- Worker version: `cf65228b-cc8f-43cd-a927-c813c0e33258`
- Do not replace it until the release owner explicitly approves production
  promotion.

## Guardrails

- Pushes to `main` must not auto-deploy production.
- Push-triggered deploys are staging-only via `site-admin-staging`.
- Production promotion requires explicit approval and one of:
  - local guarded release: `npm run release:prod`
  - manual GitHub Actions `workflow_dispatch` with `target=production`
- Prefer the local guarded release path because it runs checks, build,
  deployment, and verification in one auditable chain.

## Preflight Checklist

Run these from a clean `main` checkout:

```bash
git switch main
git pull --ff-only
git status --short
npm run release:prod:dry-run
VERIFY_CF_EXPECT_PRODUCTION_VERSION=cf65228b-cc8f-43cd-a927-c813c0e33258 npm run verify:cf:prod
npm run verify:staging:authenticated
```

Expected:

- `git status --short` prints nothing.
- `release:prod:dry-run` reports the checks/build/deploy/verify chain it
  would run and refuses real production deployment without confirmation vars.
- `verify:cf:prod` confirms production is still on
  `cf65228b-cc8f-43cd-a927-c813c0e33258`.
- `verify:staging:authenticated` confirms authenticated staging public routes
  are `200`, use `x-static-shell: 1`, `/api/site-admin/status` has
  `pendingDeploy=false`, and `/api/site-admin/preview/home` returns real
  `/_next/static/css/*.css` assets.

## Release Notes Template

Use this as the PR/release body before asking for production approval:

```markdown
## Release Candidate

- Source SHA: `<git rev-parse HEAD>`
- Source branch: `main`
- Previous production version: `cf65228b-cc8f-43cd-a927-c813c0e33258`

## Changes

- Cloudflare release/rollback hardening.
- Public web classic/Notion style stability.
- Tauri Site Admin editor stabilization.
- Content/source-store contract hardening.
- CI smoke/a11y/snapshot/perf process cleanup.

## Validation

- `npm run release:prod:dry-run`
- `VERIFY_CF_EXPECT_PRODUCTION_VERSION=cf65228b-cc8f-43cd-a927-c813c0e33258 npm run verify:cf:prod`
- `npm run verify:staging:authenticated`
- `npm run verify:cf:staging`
- GitHub PR checks: `build`, `workspace-quality`, Vercel previews

## Rollback

- Immediate Worker rollback:
  `npx wrangler rollback --env production <previous-version-id> --message "rollback production to <previous-version-id>" --yes`
- Verify rollback:
  `VERIFY_CF_EXPECT_PRODUCTION_VERSION=<previous-version-id> npm run verify:cf:prod`
```

## Promotion Command

Only run this after explicit approval:

```bash
git switch main
git pull --ff-only
export CONFIRM_PRODUCTION_DEPLOY=1
export CONFIRM_PRODUCTION_SHA="$(git rev-parse HEAD)"
npm run release:prod
```

Important:

- Do not set `VERIFY_CF_EXPECT_PRODUCTION_VERSION` during the real production
  promotion, because production is expected to change to the newly deployed
  Worker version.
- After release, capture the new active version:

```bash
set -a; source .env; set +a
npx wrangler deployments status --env production
npm run verify:cf:prod
```

## Rollback Paths

### Immediate Worker Rollback

Use this when the deployed Worker is bad and the previous Worker version is
known.

```bash
set -a; source .env; set +a
npx wrangler deployments status --env production
npx wrangler rollback --env production <previous-version-id> \
  --message "rollback production to <previous-version-id>" \
  --yes
VERIFY_CF_EXPECT_PRODUCTION_VERSION=<previous-version-id> npm run verify:cf:prod
```

### Source Rollback

Use this when source content or app code on `main` is bad and should be
reverted for future releases.

```bash
git switch main
git pull --ff-only
git revert <bad-commit-sha>
npm run release:prod:dry-run
```

Then open/merge a PR for the revert and run the normal promotion command only
after explicit production approval.

## Do Not

- Do not run direct `wrangler deploy --env production` for normal promotion.
- Do not use `npm run deploy:cf:prod` as a substitute for the guarded release
  path unless the release owner has approved an emergency manual deploy.
- Do not re-enable `main` push auto-deploy in
  `.github/workflows/deploy-on-content.yml`.
