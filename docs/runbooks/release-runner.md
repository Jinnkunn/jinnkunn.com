# Remote Release Runner

The remote release path is intentionally **not SSH as product behavior**.
Clients create HTTPS release jobs on the Cloudflare-hosted Site Admin API,
and the Mac mini release agent is woken through a narrow runner endpoint. A
low-frequency outbound poll remains as the fallback when the wake path is
unavailable.

## Shape

```text
Tauri / mobile / web admin
  -> /api/site-admin/release-jobs
  -> Cloudflare D1 queue
Cloudflare Site Admin API
  -> POST https://release-runner.jinkunchen.com/wake
Mac mini release agent (Cloudflare Tunnel + Access)
  -> /api/site-admin/release-jobs/claim preferredJobId=<job>
  -> release_agents heartbeat in D1
  -> npm release scripts in ~/Services/jinnkunn-release-runner/repo
  -> /api/site-admin/release-jobs/:id/events
  -> /api/site-admin/release-jobs/:id/complete
```

The Mac mini should be exposed through Cloudflare Tunnel, not a router port. The
runner endpoint only wakes a queued D1 job; it never accepts arbitrary shell
commands.

## Environment

On the deployed Site Admin runtime:

```bash
SITE_ADMIN_RELEASE_AGENT_TOKEN=...
RELEASE_RUNNER_WAKE_URL=https://release-runner.jinkunchen.com
RELEASE_RUNNER_WAKE_TOKEN=...
RELEASE_RUNNER_CF_ACCESS_CLIENT_ID=...
RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET=...
```

On the Mac mini agent environment:

```bash
RELEASE_AGENT_BASE_URL=https://staging.jinkunchen.com
SITE_ADMIN_RELEASE_AGENT_TOKEN=...
RELEASE_AGENT_REPO=/Users/jinnkunn/Services/jinnkunn-release-runner/repo
RELEASE_AGENT_HTTP_PORT=8789
RELEASE_AGENT_WAKE_TOKEN=...
RELEASE_AGENT_POLL_MS=60000
```

The token is separate from Cloudflare deploy credentials. It only authorizes
claiming and updating release jobs. The Cloudflare deploy token stays on the
Mac mini.

## Run

Release Center defaults to **Mac mini runner**. The Smart Release button creates
a queued job, Site Admin wakes the Mac mini runner, and logs stream back through
the Site Admin API. Non-Tauri clients, including a future mobile admin app, use
the same remote runner path. The local desktop runner remains available from
Recovery / Advanced for emergency recovery only.

Release Center also reads the runner heartbeat from `/api/site-admin/release-jobs`.
When the Mac mini poller is healthy, the top panel shows the latest agent,
last heartbeat, queued job count, and running job count. A stale or missing
heartbeat means the LaunchAgent should be checked before queueing a release.
The panel also keeps the latest remote jobs visible and exposes a read-only
**Run status check** action, so mobile or web clients can verify the Mac mini
path without starting a deploy.

Remote jobs support cancel and retry from Release Center:

- queued jobs are canceled before any runner picks them up;
- running jobs are marked canceled immediately, and the runner polls that
  state while the command is active so it can terminate the local process;
- failed or canceled jobs can be retried, which creates a new queued job with
  the same action and a `retryOf` pointer in the request payload; and
- jobs that stay `running` without log or heartbeat updates for 45 minutes are
  marked `failed/stale` automatically when the queue is read or claimed.

One-shot drain:

```bash
cd /Users/jinnkunn/Services/jinnkunn-release-runner/repo
npm run release:agent -- --once
```

Long-running wake server with fallback poller:

```bash
cd /Users/jinnkunn/Services/jinnkunn-release-runner/repo
RELEASE_AGENT_HTTP_PORT=8789 RELEASE_AGENT_POLL_MS=60000 npm run release:agent
```

Before executing a claimed job, the agent runs:

```bash
git pull --ff-only origin main
```

This keeps the Mac mini release source aligned with GitHub `main`. Use
`npm run release:agent -- --no-sync` only for local dry-run debugging.

## Mac mini LaunchAgent

The Mac mini now runs the poller through this LaunchAgent:

```text
~/Library/LaunchAgents/com.jinnkunn.release-runner.plist
```

It keeps the runner outbound-only and writes logs here:

```text
~/Services/jinnkunn-release-runner/logs/release-agent.out.log
~/Services/jinnkunn-release-runner/logs/release-agent.err.log
```

Useful operations:

```bash
launchctl print gui/501/com.jinnkunn.release-runner
launchctl kickstart -k gui/501/com.jinnkunn.release-runner
launchctl bootout gui/501/com.jinnkunn.release-runner
tail -f ~/Services/jinnkunn-release-runner/logs/release-agent.out.log
```

Manually inspect or repair the runner repo if sync fails:

```bash
cd ~/Services/jinnkunn-release-runner/repo
git pull --ff-only origin main
```

Dry-run execution for validating the queue without deploying:

```bash
npm run release:agent -- --once --dry-run
```

Wake endpoint smoke tests on the Mac mini:

```bash
curl -sS http://127.0.0.1:8789/health
curl -sS -X POST http://127.0.0.1:8789/wake \
  -H "Authorization: Bearer $RELEASE_AGENT_WAKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jobId":"<queued-job-id>","action":"status"}'
```

End-to-end remote verification from the repo:

```bash
npm run verify:release-runner
```

This checks that public access to the runner is blocked by Cloudflare Access,
that the Access policy is narrowed to a specific service token, that staging
and production Worker secrets are present, and that staging can create and wake
a harmless `status` release job on the Mac mini.

## Job Actions

The agent only runs explicit allowlisted actions:

- `status` -> `npm run release:status:json -- --skip-routes`
- `smart-release` -> `npm run release:site`
- `publish-content-staging` -> `npm run publish:content:staging`
- `deploy-staging-code` -> `npm run release:staging`
- `promote-production-code` -> `npm run release:prod:from-staging`
- `publish-content-production-from-staging` -> `npm run publish:content:prod:from-staging`

## Public Exposure

Expose the Mac mini agent only through Cloudflare Tunnel and Cloudflare Access.
Clients still talk to the Cloudflare Site Admin API; only Site Admin uses a
service token to call the runner wake endpoint. Keep the runner's own bearer
token check enabled even behind Cloudflare Access.

Current deployment:

- tunnel: `jinnkunn-release-runner`
- hostname: `https://release-runner.jinkunchen.com`
- Mac mini LaunchAgent: `com.jinnkunn.release-runner-tunnel`
- local origin: `http://127.0.0.1:8789`
- Access application: `Release Runner`
- Access policy: `Allow Site Admin Worker Service Token`
- Site Admin secrets configured in staging and production:
  - `RELEASE_RUNNER_WAKE_URL`
  - `RELEASE_RUNNER_WAKE_TOKEN`
  - `RELEASE_RUNNER_CF_ACCESS_CLIENT_ID`
  - `RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET`

The public `/health` endpoint intentionally returns only `{ "ok": true }`
without a wake token. Detailed runner status is available only when the caller
sends `Authorization: Bearer $RELEASE_AGENT_WAKE_TOKEN`.

Cloudflare Access is enabled for the hostname. Unauthenticated public requests
should receive an Access 403 before they reach the Mac mini. The Site Admin
Worker presents the Access service token headers and then the runner validates
its own bearer wake token before accepting `/wake`.

The Access policy is narrowed to the Site Admin Worker service token with a
specific `service_token.token_id` rule. Keep this scoped policy in place; do
not replace it with `any_valid_service_token` unless temporarily recovering a
broken service-token rotation.
