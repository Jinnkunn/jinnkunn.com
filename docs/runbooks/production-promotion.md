# Production Promotion Runbook

## Scope

Use this runbook when promoting the current `main` release candidate to the
Cloudflare production Worker.

Current protected production baseline:

- Worker version: `34ae93d5-e251-4277-9e49-42f535558677`
- Do not replace it until the release owner explicitly approves production
  promotion.

Current staging release candidate:

- Source SHA: `d42b8dcaa4c1087f8a2f3692cd1ee9941bac6cda`
- PRs:
  - `#5` (`codex/home-editor-canvas-layout`)
  - `#6` (`codex/release-acceptance-guardrails`)
  - `#7` (`codex/decommission-vercel-integration`)
- Staging Worker version: `de852536-e0e5-41a5-9a99-4dd402299485`
- Staging deployment: `c70ee213-43a2-4313-b33e-68694bdf6c51`
- Scope: Tauri Home canvas editor, unified Post/Page MDX editor, MDX block
  hardening, staging/public-site guardrail checks, production acceptance
  guardrails, and Vercel deployment decommission cleanup.

## Guardrails

- Pushes to `main` must not auto-deploy production.
- Push-triggered deploys are staging-only via `site-admin-staging`.
- `main` is protected by GitHub branch protection:
  - required checks: `build`, `workspace-quality`
  - strict status checks: enabled
  - force pushes and branch deletion: disabled
  - Vercel status contexts are intentionally not required.
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
VERIFY_CF_EXPECT_PRODUCTION_VERSION=34ae93d5-e251-4277-9e49-42f535558677 npm run verify:cf:prod
npm run verify:staging:authenticated
npm run check:staging-visual
```

Expected:

- `git status --short` prints nothing.
- `release:prod:dry-run` reports the checks/build/deploy/verify chain it
  would run and refuses real production deployment without confirmation vars.
- `verify:cf:prod` confirms production is still on
  `34ae93d5-e251-4277-9e49-42f535558677`.
- `verify:staging:authenticated` confirms authenticated staging public routes
  are `200`, use `x-static-shell: 1`, `/api/site-admin/status` has
  `pendingDeploy=false`, Site Admin read APIs return valid payloads for
  home/posts/pages/news/publications/works/teaching, and
  `/api/site-admin/preview/home` returns real `/_next/static/css/*.css`
  assets.
- `check:staging-visual` compares authenticated staging against production for
  homepage layout, body text color/rhythm, link treatment, Notion list
  structure, and mobile/desktop overflow.

## Tauri Editor Acceptance Checklist

Run this manually on staging before requesting production approval:

- Home editor canvas:
  - Select each block type and confirm the inspector edits the same selected
    block.
  - Move sections/blocks up and down; confirm preview ordering updates.
  - Add text, image, links, and layout sections; save; reload; confirm content
    round-trips.
- Unified Post/Page MDX editor:
  - Open an existing post and an existing page.
  - Edit in the canvas, switch to Source, then back to Write without losing
    unsupported MDX.
  - Confirm raw MDX/table/code blocks remain editable and serializable.
- Assets:
  - Upload/select an image, set alt/caption, save, reload, and confirm preview
    still uses the saved asset URL.
- Draft and history:
  - Create a local draft, reload the app, restore it, then dismiss it.
  - Open Version History and confirm previous versions are readable before
    restoring anything.
- Public preview:
  - Confirm Home/Post/Page preview typography and links still match the
    production Notion style.

## Release Notes Template

Use this as the PR/release body before asking for production approval:

```markdown
## Release Candidate

- Source SHA: `<git rev-parse HEAD>`
- Source branch: `main`
- Previous production version: `34ae93d5-e251-4277-9e49-42f535558677`
- Staging version: `de852536-e0e5-41a5-9a99-4dd402299485`

## Changes

- Tauri Home editor now uses a canvas-first editing surface.
- Post and Page editors share one MDX block editor with Source/Preview escape
  hatches.
- MDX block parsing preserves current posts/pages and unsupported raw MDX.
- Staging QA now validates public static shell routes, preview CSS assets, and
  Site Admin read API payloads.
- Vercel deployment code and GitHub workflow dependencies have been removed;
  Cloudflare is the only deployment target in this repository.

## Validation

- `npm run release:prod:dry-run`
- `VERIFY_CF_EXPECT_PRODUCTION_VERSION=34ae93d5-e251-4277-9e49-42f535558677 npm run verify:cf:prod`
- `npm run verify:staging:authenticated`
- `npm run check:staging-visual`
- `npm run verify:cf:staging`
- GitHub PR checks: `build`, `workspace-quality`

## Vercel Decommission Note

Production and staging are deployed through Cloudflare. The Vercel projects
`jinnkunn-com` and `jinnkunn-com-staging` had their Git integration
disconnected on 2026-04-25.

Historical commits and PRs can still show old Vercel status contexts because
GitHub keeps previous commit statuses. New PRs should only require GitHub
Actions checks (`build`, `workspace-quality`). If GitHub sends new mail from
the `vercel` bot after the integration disconnect, check the Vercel GitHub App
installation and project webhooks; code changes in this repository cannot stop
an external GitHub App from posting statuses.

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
