# Release workflow status (last audit: 2026-05-02)

The Tauri-driven local release path is now the primary way both staging
and production releases are issued. GitHub Actions remain wired only for
manual fallback and for tasks that genuinely need a sandbox runner
(e.g. signed `.dmg` builds). This file records the
current status of every release-adjacent workflow so we can spot
stragglers without grepping through `.github/workflows/`.

## Active

| Workflow | Trigger | Owner | Notes |
|---|---|---|---|
| `workspace-release.yml` | `git tag v*.*.*` + `workflow_dispatch` | `npm version` from `apps/workspace` | Builds + signs the Tauri `.dmg`. Must stay on a clean runner because the signing key is not on the local Mac. |
| `release-cleanup.yml` | weekly cron + `workflow_dispatch` | n/a | Prunes old `v*.*.*` releases so the Releases tab stays trimmed for `tauri-plugin-updater` consumers. |

## Standby (kept as fallback, no recent active use)

| Workflow | Trigger | Last fired | Status |
|---|---|---|---|
| `release-from-dispatch.yml` | `repository_dispatch` (release-staging / release-production) + `workflow_dispatch` | manual fallback | The app no longer auto-dispatches this from `/api/site-admin/deploy`; use it only when the local Cloudflare release cannot run. |
| `snapshot-staging-d1.yml` | `workflow_dispatch` only (cron disabled) | manual | Disaster-recovery dump from staging D1 → `content/*` PR. Auto-commit in `release-cloudflare.mjs` (issue #4) covers most drift; this stays as the explicit "rebuild git from D1" button. |

## Removed (2026-05-02 cleanup)

- `deploy-on-content.yml` — push-triggered overlay rebuild. Removed along with the github-overlay storage backend; the `site-admin-staging` content branch is no longer a meaningful source.

## Quality gates (orthogonal to releases)

`ci.yml`, `post-deploy-visual-check.yml`, `prod-smoke.yml`,
`search-snapshots.yml`, `ui-compare.yml`, `ui-smoke.yml`. These run on
PRs / push / cron and don't drive deploys. Out of scope for this audit.

## Removal criteria

A standby workflow should be removed when:

1. It has not fired in 90 days, **and**
2. The replacement path (Tauri local release + explicit manual fallback)
   covers the same scenario, **and**
3. No runbook references it as a "if X breaks, run Y" recovery step.

Bias toward keeping over removing — a stale workflow costs nothing until
it fires, and an outage at 02:00 is the wrong time to discover that the
fallback got deleted last quarter.
