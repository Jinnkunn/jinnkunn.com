# Remote Release Runner

The remote release path is intentionally **not SSH as product behavior**.
Clients create HTTPS release jobs on the Cloudflare-hosted Site Admin API,
and the Mac mini release agent polls outbound for work.

## Shape

```text
Tauri / mobile / web admin
  -> /api/site-admin/release-jobs
  -> Cloudflare D1 queue
Mac mini release agent
  -> /api/site-admin/release-jobs/claim
  -> npm release scripts in ~/Services/jinnkunn-release-runner/repo
  -> /api/site-admin/release-jobs/:id/events
  -> /api/site-admin/release-jobs/:id/complete
```

The Mac mini does not need an inbound port or a public tunnel for this path.
It only needs outbound HTTPS to the Site Admin origin and the usual Cloudflare
release credentials in its repo `.env`.

## Environment

On the deployed Site Admin runtime:

```bash
SITE_ADMIN_RELEASE_AGENT_TOKEN=...
```

On the Mac mini agent environment:

```bash
RELEASE_AGENT_BASE_URL=https://staging.jinkunchen.com
SITE_ADMIN_RELEASE_AGENT_TOKEN=...
RELEASE_AGENT_REPO=/Users/jinnkunn/Services/jinnkunn-release-runner/repo
```

The token is separate from Cloudflare deploy credentials. It only authorizes
claiming and updating release jobs. The Cloudflare deploy token stays on the
Mac mini.

## Run

In Release Center, set the runner control to **Mac mini runner**. The Smart
Release button will create a queued job and stream the runner logs back through
the Site Admin API. Non-Tauri clients, including a future mobile admin app,
always use this remote runner path.

One-shot drain:

```bash
cd /Users/jinnkunn/Services/jinnkunn-release-runner/repo
npm run release:agent -- --once
```

Long-running poller:

```bash
cd /Users/jinnkunn/Services/jinnkunn-release-runner/repo
npm run release:agent
```

Dry-run execution for validating the queue without deploying:

```bash
npm run release:agent -- --once --dry-run
```

## Job Actions

The agent only runs explicit allowlisted actions:

- `status` -> `npm run release:status:json -- --skip-routes`
- `smart-release` -> `npm run release:site`
- `publish-content-staging` -> `npm run publish:content:staging`
- `deploy-staging-code` -> `npm run release:staging`
- `promote-production-code` -> `npm run release:prod:from-staging`
- `publish-content-production-from-staging` -> `npm run publish:content:prod:from-staging`

## Public Exposure

Do not expose the Mac mini agent directly. If a future mobile app needs access
from outside the LAN, it should talk to the Cloudflare Site Admin API. If a
public hostname is needed for the control plane, put Cloudflare Access in front
of it; do not publish the Mac mini runner itself.
