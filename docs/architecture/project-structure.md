# Project Structure

This repository is a single product workspace with four major surfaces:

- Public website and Site Admin, served by Next.js and Cloudflare Workers.
- Desktop Workspace, served by Tauri under `apps/workspace`.
- Release platform, including Cloudflare deploy scripts, release jobs, and the Mac mini runner.
- Content tooling, including D1-backed content, Notion import utilities, and public calendar data.

The structure is intentionally still root-based for the Next.js app. Moving the site into
`apps/site` would touch OpenNext, Cloudflare deploy paths, static-shell export, content dumps,
and CI at the same time. Keep that as a later migration only after the release pipeline is quieter.

## Top-Level Boundaries

| Path | Owns | Notes |
| --- | --- | --- |
| `app/` | Next.js App Router routes | Public routes live under `app/(classic)`. API routes live under `app/api`. |
| `components/` | Website React components | Public-web components and Site Admin web components. |
| `lib/` | Website/server shared logic | Route, SEO, search, Site Admin, D1, release status, public calendar, and shared TS/MJS facades. |
| `apps/workspace/` | Tauri desktop app | Workspace UI, module registry, local-first surfaces, and Rust commands. |
| `content/` | Content source and generated content | `content/pages` and `content/posts` are editable content; `content/generated` is generated output. |
| `cloudflare/` | Worker entry and Cloudflare-only runtime glue | Keep public shell short-circuit logic here. |
| `migrations/` | D1 migrations | Shared by Site Admin, release jobs, and public calendar persistence. |
| `scripts/` | Operational tooling | Split by responsibility; see below. |
| `tests/` | Node test suite | Split by product/infra domain; `npm test` still runs all `tests/**/*.test.mjs`. |
| `docs/` | Architecture, runbooks, and design-system notes | Keep operational decisions here instead of burying them in scripts. |

## Script Boundaries

| Path | Owns |
| --- | --- |
| `scripts/_lib/` | Shared script helpers. No product-specific orchestration. |
| `scripts/build/` | Build-time helpers such as `prebuild` and static shell asset export. |
| `scripts/content/` | D1 content dump, content publish, DB migration, and Notion sync. |
| `scripts/content/notion-sync/` | Notion-specific import/render pipeline. |
| `scripts/release/` | Cloudflare deploy, release status, production promotion, release agent, and runner verification. |
| `scripts/qa/` | Smoke tests, visual/a11y/perf checks, design-system checks, and workspace QA scripts. |
| `scripts/workspace/` | Workspace-specific local tools such as the MCP server. |

Default package scripts should point at these categorized paths. Avoid adding new executable scripts
directly under `scripts/` unless they are short-lived migration helpers.

## Test Boundaries

| Path | Owns |
| --- | --- |
| `tests/calendar/` | Public calendar serialization, DB projection, hydration, and tag logic. |
| `tests/content/` | Content stores, page/post parsing, slugs, assets, redirects, and editor/content round trips. |
| `tests/design-system/` | Design tokens, primitives, theme, and style guardrails. |
| `tests/notion-sync/` | Notion adapters and sync/render pipeline. |
| `tests/public-web/` | Public website rendering, SEO, sitemap, routes, publications, static shell, and public style contracts. |
| `tests/release/` | Cloudflare deploy, release metadata, jobs, guards, and runner wake behavior. |
| `tests/search/` | Search API model, service, ranking, and contracts. |
| `tests/security/` | Auth, rate limiting, protected routes, and access-mode parsing. |
| `tests/site-admin/` | Site Admin contracts, source store, route explorer, preview, and sync service. |
| `tests/shared/` | Small shared utilities and cross-runtime facades. |
| `tests/workspace/` | Tauri/workspace engineering guardrails and MCP behavior. |

New tests should live beside their domain rather than returning to a flat `tests/` root.

## Migration Rule

Prefer small boundary-preserving moves over big app moves:

1. Move scripts/tests/docs first.
2. Extract stable pure logic into `lib/shared` or a future package only when two surfaces truly share it.
3. Move the Next site into `apps/site` only after Cloudflare build/deploy, static shell export, and content publish scripts no longer assume the repo root as the site root.
