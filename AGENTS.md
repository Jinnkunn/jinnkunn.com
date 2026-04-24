# AGENTS

## Cloudflare Deploy Guardrails

- `wrangler deploy` does not reliably pick up project `.env` for auth in all contexts.
- If `CLOUDFLARE_API_TOKEN` is stale in the shell env, deploy may fail with:
  - `Authentication error [code: 10000]`
  - even when `.env` has a valid token.

Use one of these patterns before deploy:

```bash
set -a; source .env; set +a
npx wrangler deploy --env production
```

or single-command injection:

```bash
CF_TOKEN=$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' .env | head -n1)
CF_ACCOUNT=$(sed -n 's/^CLOUDFLARE_ACCOUNT_ID=//p' .env | head -n1)
CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT" npx wrangler deploy --env production
```

## Deployment Semantics Guardrail

- For normal release/promotion, use:
  - `npm run deploy:cf:staging`
  - `npm run deploy:cf:prod`
- These paths annotate deployments with `source=<sha> branch=<name>`.
- Avoid direct `wrangler deploy` without `--message`, because missing source metadata makes `/api/site-admin/status` fall back to `pendingDeploy=null`.

## Minimum Cloudflare Token Scope (Deploy Path)

- Account:
  - `Workers Scripts: Edit`
  - `Workers Tail: Read` (recommended)
- Zone:
  - `Zone: Read`
  - `Workers Routes: Edit` (if route binding is managed by deploy)

## Quick Verification After Deploy

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://jinkunchen.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://jinkunchen.com/blog
curl -sS -o /dev/null -w '%{http_code}\n' https://jinkunchen.com/api/site-admin/status
```

- Expected:
  - `/` -> `200`
  - `/blog` -> `200`
  - `/api/site-admin/status` -> `401` when unauthenticated

## Cloudflare Free Plan CPU Limit (Critical)

- This project is currently deployed on **Workers Free** (confirmed by Wrangler/API error `100328` when setting `[limits].cpu_ms`).
- Workers Free has a **10ms CPU/request** cap. OpenNext/Next.js runtime can intermittently exceed this and return:
  - Cloudflare `1102` (`Worker exceeded CPU time limit`)
  - request timeouts / canceled `waitUntil` tasks in `wrangler tail`

### Operational Impact

- Intermittent `1102` on public pages (for example `/blog`, `/`, `/publications`, `/sitemap`) is expected on Free plan under normal traffic variance.
- This is not fully fixable by app-level micro-optimizations alone.

### Required Next Decision

- Preferred: upgrade account to **Workers Paid**, then set runtime limits in `wrangler.toml`:

```toml
[limits]
cpu_ms = 300000
```

- Alternative: split architecture so public site is served without Worker runtime hot path (static host / Pages), and keep Worker only for admin/API.

## Free Plan Mitigation Applied (Static Shell Short-Circuit)

- A public-route mitigation is now in place for Free plan:
  - `cloudflare/worker-entry.mjs` is the Worker entrypoint.
  - It tries `env.ASSETS.fetch()` for prerendered HTML under `/__static/*` first.
  - On hit, it returns immediately with header `x-static-shell: 1`.
  - On miss, it falls back to OpenNext runtime.
- Prerendered HTML assets are exported from Next build output by:
  - `scripts/export-static-shell-assets.mjs`
  - invoked automatically by `npm run build:cf`.

### Operational Notes

- This mitigation is intended to keep public pages stable on Workers Free.
- Admin and API paths are still served by OpenNext runtime.
- If adding new public routes, ensure they are present in `.next/server/app/*.html` so export can include them.

## Next 16 `proxy.ts` Compatibility (Current Blocker)

- Next.js 16 recommends replacing `middleware.ts` with `proxy.ts`.
- In current stack (`next@16.1.6` + `@opennextjs/cloudflare@1.19.3`), moving to `proxy.ts` breaks Cloudflare build with:
  - `ERROR Node.js middleware is not currently supported. Consider switching to Edge Middleware.`
- `proxy.ts` is currently Node-only in Next 16, so it cannot be forced to Edge runtime.
- Keep runtime gating logic in `middleware.ts` for now, even with deprecation warning, until OpenNext adds Node middleware/proxy support.

### Practical Rule

- Do **not** migrate `middleware.ts` to `proxy.ts` in this repo yet.
- If trying future upgrades, validate with:

```bash
npm run build
npm run build:cf
```
