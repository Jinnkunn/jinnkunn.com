# Production Promotion Runbook

## Scope

Use this runbook when publishing website content or promoting the current
`main` release candidate to the Cloudflare production Worker. Do not rely on
static baseline/version ids in this document; always read live status from the
Release Center or the dry-run commands below.

## Guardrails

- Pushes to `main` must not auto-deploy production.
- Push-triggered GitHub jobs are not the routine deploy path. Use local
  Cloudflare release commands from the Tauri workspace or CLI; keep
  GitHub Actions as an explicit fallback only.
- `main` is protected by GitHub branch protection:
  - required checks: `build`, `workspace-quality`
  - strict status checks: enabled
  - force pushes and branch deletion: disabled
  - Vercel status contexts are intentionally not required.
- Production promotion requires explicit approval and one of:
  - one-click in the workspace: the Site Admin **Release Center** **Smart
    Release** action. It decides between staging content, staging code,
    production code, production content copy, and no-op.
  - live status check: `npm run release:status`, which reads Cloudflare
    Worker versions, D1 overlay snapshots, and route parity from the live
    environments.
  - Smart CLI entry: `npm run release:site`
  - one-shot promote-from-staging (CLI):
    `npm run release:prod:from-staging`
  - the older guarded release: `npm run release:prod`
  - manual GitHub Actions `workflow_dispatch` with `target=production`
    as a fallback only
- Prefer `release:prod:from-staging` for routine releases. It reads the
  staging Worker, refuses to proceed unless staging matches the local
  release-source HEAD, runs the heavy verifications automatically, snapshots the
  outgoing production version into
  [production-version-history.md](./production-version-history.md), then
  invokes `release:prod --skip-checks` with the confirmation env vars
  pre-populated, preserves production D1, and rebuilds the production static
  overlay from production D1 after the Worker deploy. Fall back to the
  long-form path below if you need finer-grained control or are recovering
  from a partial release.

## Content-from-D1 sync

The staging worker runs `SITE_ADMIN_STORAGE=db` (per `wrangler.toml`), so its
canonical content lives in D1. `release:staging` archives the requested Git SHA
into an immutable directory under `.cache/release/snapshots/`, dumps staging D1
into that snapshot, and builds there. It never rewrites the operator's working
tree during the normal release path.

When Git needs a content backup, use the explicit sync path. It retains the
dirty-content guard because this command intentionally rewrites root
`content/*` before committing:

```bash
npm run release:staging:sync-git
```

Every full staging and production release uses an immutable snapshot of the
committed source SHA. Tracked edits and untracked files in the working tree are
excluded from the Worker bundle. Production still requires a clean tree and
explicit SHA confirmation; staging may run while unrelated local work exists,
but the release will contain committed code only.

Build-cache reuse is content-addressed as well as code-addressed. Recovery with
`--skip-build` requires both an existing build cache for the exact Git SHA and
an explicit `RELEASE_EXPECT_CONTENT_SHA`; the release fails closed when either
identity cannot be proven. Routine `release:prod:from-staging` supplies the
expected staging content SHA automatically and requires the complete staging
artifact. If that artifact is missing, promotion stops and asks for a new
staging release instead of rebuilding different bytes for production.

## Content-only fast publish

For article/page/news text edits that do not change React code, CSS, images,
or other `/_next/static/*` assets, use the content-only path:

```bash
npm run publish:content:staging
npm run publish:content:prod:from-staging
```

The Tauri Release Center exposes this as **Smart Release**. Content uses a
two-step production path: publish the staging overlay first, verify staging,
then copy the exact same verified overlay to production.

This path:

- dumps staging D1 to `content/*` for staging publishes;
- auto-commits content-only drift on `main`;
- computes `contentInputSha` before building;
- skips the Next build entirely when `contentInputSha`, active Worker code SHA,
  and live build id already match the current overlay status;
- rebuilds the Next HTML shells with the currently deployed build id;
- verifies every referenced `/_next/static/*` asset already exists on the
  target environment;
- uploads only changed generated `/__static/*.html` and policy JSON rows into
  `static_shell_overlays` in the target D1;
- stores the previous overlay rows as a D1 rollback snapshot before any
  overlay change; and
- verifies public routes return `x-static-overlay: 1`; and
- for production, copies the verified staging overlay instead of rebuilding.

If the asset check fails, do not force it. That means the edit changed code,
CSS, or another static asset. Run the normal `release:staging` /
`release:prod:from-staging` path instead.

Useful recovery commands:

```bash
npm run publish:content:staging:rollback
npm run publish:content:staging:clear
npm run publish:content:prod:rollback
npm run publish:content:prod:clear
```

Full Worker releases (`release:staging` / `release:prod:from-staging`) clear
the target content overlay after deploying the code bundle. Production
promotion then immediately rebuilds that overlay from production D1, preserving
content authored in the production Site Admin while adopting the new code and
static assets.

## Routine Release (recommended)

### Workspace Smart Release (preferred)

1. Open the Tauri workspace, connect to the **staging** profile.
2. Confirm the editor's saved content is what you want in production
   (e.g. via the Tauri editor acceptance checklist below).
3. Open **Site Admin → Release**. The top area should only require **Smart
   Release**, the release target, and **Refresh** for normal work. Use
   **Staging to Production** when public pages should match; use **Staging only**
   for preview-only checks.
4. Click **Smart Release**:
   - content edits run `npm run publish:content:staging`;
   - code/static asset changes run `npm run release:staging`;
   - production code changes open the promote confirmation, then run
     `npm run release:prod:from-staging`;
   - verified staging content opens **Publish Same Content to Production**,
     then runs `npm run publish:content:prod:from-staging`;
   - no-op refreshes status and does not build.
   - The Code vs Content panel shows Local Code, Staging Code, Production Code,
     Staging Overlay, and Production Overlay.
   - If production is behind staging, the panel explains the mismatch and names
     the next Smart Release step.
5. Keep the panel open while it runs. The activity stream shows the current
   phase, stdout/stderr tail, success/failure state, and a cancel action.
6. After release, review **Recent Releases**. Production entries expose copyable
   rollback commands and a one-click local rollback action for known Worker
   versions.

GitHub Dispatch is intentionally labeled as a fallback in the app. Routine
staging and production publishing should use the local Cloudflare path so normal
content/calendar releases do not consume GitHub Actions minutes.

Routine production promotion writes audit entries to
`.cache/release/release-history.jsonl`, not tracked markdown, so a successful
release does not dirty the git worktree. `docs/runbooks/production-version-history.md`
is now a manual/exported rollback report; if it is the only dirty file, the
local production promotion path still treats it as safe to continue.

If the button is greyed out:
- "Staging stale" — staging hasn't been re-released since
  the current release-source commit. Run `npm run release:staging` (or click
  **Publish Staging** on this surface) and retry.
- "No changes vs prod" — production is already on the same code/content
  snapshot as staging.

### CLI smart path

```bash
git switch main
git pull --ff-only
git status --short
npm run release:site:dry-run
npm run release:site
```

For live status or the second production content step:

```bash
npm run release:status
npm run release:site -- --production-content
```

`release:status` reports the same next action that Smart Release uses, plus
route parity for `/`, `/news`, `/blog`, and `/calendar`. If staging requires a
browser login and the local synthetic session is not accepted, those route rows
are reported as `gated skipped` rather than treated as production drift.

### CLI recovery fallback

```bash
git switch main
git pull --ff-only
git status --short
npm run release:staging
npm run release:prod:from-staging:dry-run
npm run release:prod:from-staging
```

`release:prod:from-staging` will refuse to promote if:

- the local branch is not `main`;
- the working tree is dirty;
- the staging worker's deployed `code=` SHA does not match the local
  release-source HEAD (i.e. you forgot to run `release:staging` after a new
  commit landed).

Pass `--skip-visual` to skip the slow Playwright pass, or
`--note "<message>"` to annotate the version-history row. See
`scripts/release/release-from-staging.mjs` for the full flag list.

## Long-form Preflight Checklist (fallback)

Run these from a clean `main` checkout when you need to debug a
release manually rather than trust the wrapper:

```bash
git switch main
git pull --ff-only
git status --short
npm run release:prod:dry-run
npm run verify:cf:prod
npm run verify:staging:authenticated
npm run check:staging-visual
```

Expected:

- `git status --short` prints nothing.
- `release:prod:dry-run` reports the checks/build/deploy/verify chain it
  would run and refuses real production deployment without confirmation vars.
- `verify:cf:prod` confirms production is reachable and reports the live
  Worker version.
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

Use the full checklist in
[`docs/runbooks/tauri-site-admin-qa.md`](./tauri-site-admin-qa.md). The summary
below is the minimum manual pass before requesting production approval.

Run this manually on staging before requesting production approval:

- Home editor:
  - Confirm Home uses the shared MDX document editor with Write, Source, and
    Preview modes.
  - Move blocks up and down; confirm preview ordering updates.
  - Add text, image, Hero, Link list, Featured pages, and Columns blocks; save;
    reload; confirm content round-trips through `content/home.json`.
- Page tree:
  - Confirm sidebar page order persists through `content/page-tree.json`.
  - Rename/reparent a disposable page and confirm reload preserves the updated
    tree.
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
- Previous production version: `<from Release Center or verify:cf:prod>`
- Staging version: `<from Release Center or release:prod:from-staging:dry-run>`

## Changes

- `<high-level user-facing change>`
- `<release-risk or migration note>`
- `<validation focus>`

## Validation

- `npm run release:prod:dry-run`
- `npm run verify:cf:prod`
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
git push origin main
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

The fastest way to find the previous version ID is
[production-version-history.md](./production-version-history.md) — every
production release writes a row there with the outgoing version's ID
before the new one takes over. The first row under the table header is
the most recent.

If the history file is empty (or you don't trust it), fall back to
`npx wrangler deployments status --env production` to enumerate
versions live.

```bash
set -a; source .env; set +a
# Either: read the previous version ID from production-version-history.md
# Or:     npx wrangler deployments status --env production
npx wrangler rollback --env production <previous-version-id> \
  --message "rollback production to <previous-version-id>" \
  --yes
VERIFY_CF_EXPECT_PRODUCTION_VERSION=<previous-version-id> npm run verify:cf:prod
# Record that we rolled back so the history reflects reality.
npm run snapshot:prod -- --note "Rolled back to <previous-version-id>"
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
