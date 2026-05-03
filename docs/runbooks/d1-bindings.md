# D1 Bindings Runbook

## TL;DR

- **Staging D1 is the source of truth** for every operator-edited file
  (nav, page bodies, blog posts, link audit, etc.).
- **Production D1 exists but is unused.** Both staging *and* production
  builds dump from staging D1 (`scripts/release-cloudflare.mjs` for the
  local path, `.github/workflows/release-from-dispatch.yml` for fallback);
  production D1 receives no writes through any operator path.
- **We don't delete production D1** — leaving it bound costs $0 and
  removing the binding would break wrangler config without any benefit.
  Just don't trust its contents for anything.

## Why two D1s if only one matters

Cloudflare Workers bind a D1 per `[env.<name>]` block in `wrangler.toml`.
Production worker has its own binding (`SITE_ADMIN_DB`) pointing at a
*production* D1 instance. Originally each instance was meant to be
edited independently; in practice the operator only ever connects the
workspace app to the staging worker, so production D1 has been an
unused side-channel since launch.

The `2026-04-29` Calendar nav incident exposed the gap:

1. Operator added a Calendar nav item via the workspace → staging D1.
2. Promote-to-Production button dispatched `release-production`.
3. Workflow ran with `SITE_ADMIN_DB_ENV: ${{ env.TARGET_ENV }}` →
   `SITE_ADMIN_DB_ENV=production` → prebuild dumped *production* D1.
4. Production D1 was a 1.3 KB snapshot from before Calendar nav existed.
5. The dump overwrote git's up-to-date `content/filesystem/site-config.json`
   in the worker bundle.
6. Production worker shipped without the new nav, even though its code
   SHA was correct.

Fix landed in commit `b8194e1`: pin `SITE_ADMIN_DB_ENV: staging` for
both targets. "Promote to Production" now ships exactly what the
operator just looked at on staging.

## Guardrails

- `scripts/release-cloudflare.mjs` forces build-time `SITE_ADMIN_DB_ENV=staging`
  for both local staging and production releases.
- The release script records a post-build `content=` snapshot hash in Worker
  metadata. This is what lets production preflight detect content-only edits
  even when `code=` is unchanged.
- `build:cf` artifact reuse is disabled by default because staging D1 can
  change without a git commit. `ALLOW_D1_BUILD_CACHE=1` is an explicit
  operator override, not the routine path.
- `tests/release-from-dispatch-contract.test.mjs` re-asserts the fallback
  workflow pin and fails any future change that re-binds
  `SITE_ADMIN_DB_ENV` to `TARGET_ENV`.
- `.github/workflows/snapshot-staging-d1.yml` is manual-only. Dispatch it
  when staging D1 needs a git recovery/audit snapshot; the weekday
  schedule stays disabled to avoid routine Actions minutes.
- `.github/workflows/post-deploy-visual-check.yml` runs on every
  successful release-from-dispatch run and Playwright-compares
  staging.jinkunchen.com to jinkunchen.com — catches a class of "deploy
  succeeded but the result looks wrong" failures the dispatch path's
  CI checks no longer cover.

## When the production D1 binding *will* matter

If we ever:

- expose a "preview a draft on production-only" feature, or
- build a production-only content surface that the workspace can target
  (currently it can't), or
- run a "Recover production worker without redeploying" flow that reads
  D1 at runtime,

we'll need to either keep production D1 in sync (add a copy step to the
promote workflow), or change the binding to share the staging instance.
Until then: leave it.

## Operator commands

| Goal | Command |
| --- | --- |
| Show what's edited in staging D1 vs. git | `npm run db:diff:staging` |
| Same, machine-readable | `npm run db:diff:staging:json` |
| Force a fresh git snapshot of staging D1 | dispatch `Snapshot staging D1 to git` workflow |
| Show last 10 production deploys | `npm run snapshot:prod:list` |
| Inspect production D1 directly (rare) | `npx wrangler d1 execute SITE_ADMIN_DB --env=production --remote --command "..."` |

## See also

- `docs/runbooks/production-promotion.md` — the full promote flow
- `lib/server/promote-to-production-service.ts` — Cloudflare preflight +
  GitHub fallback URL service used by the workspace's production promotion panel
- `scripts/dump-content-from-db.mjs` — the dump script (with `--diff-only`)
- `tests/release-from-dispatch-contract.test.mjs` — workflow guardrails
