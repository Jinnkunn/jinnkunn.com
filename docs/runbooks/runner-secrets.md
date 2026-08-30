# Release Runner Secrets & Rebuild Inventory

Everything the Mac mini runner needs that is NOT in git, by name, with where
to re-issue it. **Never write secret values into this file.** With this page,
the plist templates under `scripts/release/launchd/`, and
`scripts/release/setup-runner.mjs`, a dead runner machine is a restore, not an
archaeology project.

## Rebuild procedure (new machine)

```bash
mkdir -p ~/Services/jinnkunn-release-runner
git clone git@github.com:Jinnkunn/jinnkunn.com.git ~/Services/jinnkunn-release-runner/repo
cd ~/Services/jinnkunn-release-runner/repo
npm ci && npm ci --prefix apps/workspace
# Recreate .env/.env.local from the tables below, then:
node scripts/release/setup-runner.mjs
npm run verify:release-runner
```

If promotion is needed before the new machine has staged anything, the
verified staging artifact is fetched from R2 automatically (see
`scripts/_lib/release-artifact-store.mjs`); no rebuild-from-scratch of the
staging release is required as long as the artifact store was enabled when
staging was last released.

## Runner `.env` / `.env.local` keys

Required (agent refuses to run or deploy without these):

| Key | Purpose | Where to re-issue |
| --- | --- | --- |
| `SITE_ADMIN_RELEASE_AGENT_TOKEN` | Authorizes claiming/updating release jobs | Generate (`openssl rand -hex 32`); set the SAME value as a `wrangler secret put` on staging + production workers |
| `CLOUDFLARE_API_TOKEN` | Deploy token: Workers Scripts Edit, D1 Edit, R2 Edit, Access Read | Cloudflare dashboard → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier (not secret) | Cloudflare dashboard account home |

Wake path + verification (agent still polls without them, but the wake
endpoint, `verify:release-runner`, and authenticated staging checks need
them):

| Key | Purpose | Where to re-issue |
| --- | --- | --- |
| `RELEASE_AGENT_HTTP_PORT` | Local wake server port (`8789`) | Config, not secret |
| `RELEASE_AGENT_WAKE_TOKEN` | Bearer token the wake server requires | Generate; must equal the workers' `RELEASE_RUNNER_WAKE_TOKEN` secret |
| `RELEASE_RUNNER_CF_ACCESS_CLIENT_ID` / `RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET` | Access service token for calling the runner hostname | Zero Trust → Access → Service Tokens; also update the workers' secrets and confirm the Access policy still pins this token id |
| `RELEASE_RUNNER_WAKE_URL` | `https://release-runner.jinkunchen.com` (not secret) | Config |
| `NEXTAUTH_SECRET` (or `SITE_ADMIN_APP_TOKEN_SECRET`) | Signs the synthetic admin session used by authenticated verification | Must equal the workers' secret of the same name |
| `RELEASE_AGENT_BASE_URL` | Site Admin API origin (`https://staging.jinkunchen.com`) | Config |
| `RELEASE_AGENT_REPO` | Runner repo path | Config |
| `RELEASE_RUNNER_HOST` | Set to `1` on the runner machine so `verify:release-runner` treats missing LaunchAgents as a hard failure | Config |

## Worker-side secrets (`wrangler secret put`, staging AND production)

`verify:release-runner` asserts these exist on both environments:

- `SITE_ADMIN_RELEASE_AGENT_TOKEN`
- `RELEASE_RUNNER_WAKE_URL`
- `RELEASE_RUNNER_WAKE_TOKEN`
- `RELEASE_RUNNER_CF_ACCESS_CLIENT_ID`
- `RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET`

## Other machine-local state

| State | Rebuild |
| --- | --- |
| Cloudflare Tunnel credentials (`~/.cloudflared/`) | `cloudflared tunnel login`, `cloudflared tunnel create jinnkunn-release-runner` (or reuse the existing tunnel id), `cloudflared tunnel route dns` for `release-runner.jinkunchen.com` |
| LaunchAgents | `node scripts/release/setup-runner.mjs` renders + loads both from the templates in `scripts/release/launchd/` |
| Sleep settings | `sudo pmset -c sleep 0` (setup-runner warns when sleep is enabled) |
| `node_modules` caches | `npm ci` at repo root and `apps/workspace` |
| Per-SHA staging build artifacts | Mirrored to R2 after each verified staging release; local cache refills on the next `release:staging` |
| Release history | Written to the shared `release_history` table in the staging control-plane D1 (plus a per-machine JSONL under `.cache/release/`) |
