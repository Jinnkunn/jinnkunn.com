# D1 Bindings Runbook

## TL;DR

- **Staging D1 is the Draft content source** used to preview edits before a
  code or content promotion.
- **Production D1 is the Live content source.** Content saved in the
  production Site Admin remains authoritative and is published through the
  production static overlay without a Worker rebuild.
- Production code promotion builds the verified code against production's
  last **published** snapshot. It never reads or copies either Draft table.
  It verifies a versioned overlay before activating the new Worker.
- **We don't delete production D1** — leaving it bound costs $0 and
  removing the binding would break Live editing and overlay publishing.

## Why two D1s if only one matters

Cloudflare Workers bind a D1 per `[env.<name>]` block in `wrangler.toml`.
Production worker has its own binding (`SITE_ADMIN_DB`) pointing at a
*production* D1 instance. Staging and production are intentionally separate:
staging supports draft review, while production stores production-authored
content and the static-shell overlay currently served to visitors.

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

The earlier fix pinned the staging content environment for both targets.
The current release path supersedes it: the code is verified in staging,
but each environment uses only its own already-published sources.

## Guardrails

- `scripts/release/release-cloudflare.mjs` pins the destination's Live
  sources and disables draft synchronization during candidate builds.
- The release script records a post-build `content=` snapshot hash in Worker
  metadata. This is what lets production preflight detect content-only edits
  even when `code=` is unchanged.
- The staging artifact mirror is useful for inspection, not as the
  source of production content. Production builds its own candidate.
- The fallback workflow uses the same guarded CLI entrypoints.
- `.github/workflows/snapshot-staging-d1.yml` is manual-only. Dispatch it
  when staging D1 needs a git recovery/audit snapshot; the weekday
  schedule stays disabled to avoid routine Actions minutes.
- `.github/workflows/post-deploy-visual-check.yml` runs on every
  successful release-from-dispatch run and Playwright-compares
  staging.jinkunchen.com to jinkunchen.com — catches a class of "deploy
  succeeded but the result looks wrong" failures the dispatch path's
  CI checks no longer cover.

## Production D1 safety boundary

Production Site Admin writes directly to production D1. Normal code promotion
preserves those rows and the independent Live snapshot. Only an explicit
content publication changes what visitors read. The
`db:copy:staging-to-production` command remains available only for deliberate
recovery or migration; it is never called by the promotion script.

## Content-only overlay table

`scripts/content/publish-content.mjs` writes generated public HTML shells into
`static_shell_overlays`:

- staging: `npm run publish:content:staging`
- production: `npm run publish:content:prod`

The Worker checks that table before bundled `ASSETS` when
`STATIC_SHELL_OVERLAY=1`. This lets article/page/news text changes update
without deploying a new Worker version. The script refuses to publish when
new HTML references `/_next/static/*` assets that are not already live, which
keeps content-only publishing from accidentally shipping code/CSS changes.

`publish-content.mjs` now publishes incrementally:

- it compares generated shell hashes against existing overlay rows;
- uploads only changed rows and deletes stale rows;
- stores the previous overlay in `static_shell_overlay_snapshots` and
  `static_shell_overlay_versions`; and
- supports rollback/clear without rebuilding the Worker.

Full Worker releases clear the target overlay after deploy so D1 overlay HTML
does not shadow the freshly deployed bundle.

## Operator commands

| Goal | Command |
| --- | --- |
| Show what's edited in staging D1 vs. git | `npm run db:diff:staging` |
| Same, machine-readable | `npm run db:diff:staging:json` |
| Replace production D1 from staging during deliberate recovery | `npm run db:copy:staging-to-production` |
| Force a fresh git snapshot of staging D1 | dispatch `Snapshot staging D1 to git` workflow |
| Publish content-only staging HTML without Worker deploy | `npm run publish:content:staging` |
| Publish production D1 content to production static overlay without Worker deploy | `npm run publish:content:prod` |
| Roll back staging content overlay | `npm run publish:content:staging:rollback` |
| Clear staging content overlay | `npm run publish:content:staging:clear` |
| List staging content overlay snapshots | `npm run publish:content:staging:snapshots` |
| Show last 10 production deploys | `npm run snapshot:prod:list` |
| Inspect production D1 directly (rare) | `npx wrangler d1 execute SITE_ADMIN_DB --env=production --remote --command "..."` |

## See also

- `docs/runbooks/production-promotion.md` — the full promote flow
- `lib/server/promote-to-production-service.ts` — Cloudflare preflight +
  GitHub fallback URL service used by the workspace's production promotion panel
- `scripts/content/dump-content-from-db.mjs` — the dump script (with `--diff-only`)
- `tests/release-from-dispatch-contract.test.mjs` — workflow guardrails
