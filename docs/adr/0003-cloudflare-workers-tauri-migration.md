# ADR-0003: Cloudflare + Notion Exit + Tauri Workspace Direction

- Status: Accepted
- Date: 2026-04-22
- Owners: Site platform / site-admin

## Context

The current production path is still tightly coupled to Notion:

- Content sync and generated artifacts are still driven by `sync:notion`.
- `/site-admin/config` and `/site-admin/routes` still read/write Notion databases.
- Deploy logging still contains Notion integrations.
- Runtime has a Notion asset fallback route.

At the same time, we want:

1. Cloudflare-first hosting and deployment.
2. Full exit from Notion as operational source of truth.
3. Admin capabilities moved into a desktop/mobile app foundation that can evolve into a personal workspace.

## Decisions

1. Deployment direction

- Accept "Workers-first" for full-stack Next.js runtime.
- Pages remains optional for static-only or compatibility edges.

2. Auth direction

- Choose the more standardized approach: Cloudflare Access + Managed OAuth for human clients.
- Service tokens remain machine-to-machine fallback only.

3. Data direction

- Unify workspace/service state in D1 where persistent structured app data is needed.
- Site content source remains Git-backed files (`content/filesystem/*`) to preserve auditability and simple rollback.

## Target Architecture (v1 baseline)

- Web runtime: Next.js on Cloudflare Workers (OpenNext adapter path).
- Site source: Git repository files.
- Assets: R2 (custom domain), no Notion asset fallback.
- Admin API: independent backend boundary (Worker API), reused by web admin and Tauri clients.
- App shell: Tauri desktop + mobile, modular for future non-site workspace features.

## Non-goals (for this migration wave)

- No field-level conflict merge.
- No editorial CMS/page-body WYSIWYG redesign.
- No PR approval flow as mandatory save path.

## Execution Plan

## Phase 1: Source-of-truth decoupling

- Introduce `SiteAdminSourceStore` contract with `filesystem` and `github` implementations.
- Move config/routes API to source-store reads/writes.
- Enforce optimistic concurrency with `sourceVersion` and `SOURCE_CONFLICT`.
- Keep deploy separate from save.

Exit criteria:

- Config/routes can be saved without Notion dependencies.
- Conflict behavior is deterministic (`409 + SOURCE_CONFLICT`).

## Phase 2: Cloudflare cutover path

- Stage environment on Cloudflare with source branch isolation.
- Replace Vercel-oriented deploy hook assumptions with Cloudflare build/deploy hooks.
- Validate "Save writes source, Deploy publishes" on staging before production.

Exit criteria:

- Staging and production follow the same save/deploy semantics.
- Production no longer depends on Vercel-only deployment behavior.

## Phase 3: Notion removal completion

- Remove `/notion-assets` fallback.
- Remove Notion deploy-log/status dependencies.
- Delete Notion sync runtime assumptions from operational path.

Exit criteria:

- Runtime and admin critical paths function without `NOTION_*`.

## Phase 4: Admin backend hard boundary

- Split admin-facing service APIs into a reusable backend boundary.
- Prepare auth model for browser + Tauri clients using Access/OAuth.
- Standardize audit trail and operation logging in D1.

Exit criteria:

- Same API contract is consumed by web admin and app clients.

## Phase 5: Tauri app baseline

- Ship site-admin core operations in Tauri (config/routes/save/deploy/status).
- Add capability-scoped command boundaries.
- Add modular workspace shell for future domains (for example calendar).

Exit criteria:

- Day-to-day site operations can be performed from desktop/mobile app.

## Rollback Strategy

- Source changes: revert offending source commits, then redeploy.
- Runtime changes: rollback Worker deployment version.
- Data/API changes: backward-compatible contract during phase transitions.

## Operational Principles

- Save and deploy remain separate actions.
- Staging-first for infra or auth changes.
- No destructive migration without reversible checkpoint.
