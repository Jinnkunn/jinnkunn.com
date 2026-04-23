# Cloudflare Access as the site-admin identity provider

This runbook describes the staged migration from GitHub-OAuth-via-NextAuth
to Cloudflare Access (CF Access) as the sole identity provider for
`/api/site-admin/**` and `/site-admin/**`.

---

## Why

- One IdP management surface instead of NextAuth + Cloudflare Access side by side.
- Free on CF up to 50 users; supports passkey / OTP / GitHub / Google / SAML / Okta without code changes.
- Service tokens replace our hand-rolled HMAC app tokens — rotation and revocation happen in the CF dashboard.
- Removes the local-dev footgun where missing `GITHUB_ID` silently fails.

## Architecture

```
                  ┌────────────────────────────────────────────┐
                  │ Cloudflare Access (team: jinnkunn)         │
                  │   - Self-hosted Application: jinkunchen    │
                  │   - Policies: email allow-list, service    │
                  │     tokens for Tauri                       │
                  └──────────────────────┬─────────────────────┘
                                         │ verified identity
                                         ▼
                            Cf-Access-Jwt-Assertion
                                         │
                                         ▼
              ┌────────────────────────────────────────────┐
              │ Cloudflare Worker (our OpenNext bundle)    │
              │   verifyCloudflareAccessFromHeaders        │
              │     → JWKS fetch (cached 1h)               │
              │     → RS256 signature check                │
              │     → iss/aud/exp/nbf checks               │
              │     → email/common_name → allow-list match │
              └────────────────────────────────────────────┘
```

## Phase 1 — dual-mode (shipped)

In this phase the code accepts **both** the existing NextAuth cookie / HMAC
bearer-token path **and** the new Cloudflare Access path. Nothing breaks if
CF Access is not yet configured.

Code changes:

- `lib/server/cloudflare-access-auth.ts` — JWKS fetch + cache + RS256 verifier.
- `lib/site-admin-auth.ts` — adds `verifySiteAdminCloudflareAccess()`,
  `parseAllowedAdminEmails()`, `parseAllowedServiceTokens()`, and
  `parseSiteAdminAuthMode()`.
- `lib/server/site-admin-api.ts` — `requireSiteAdminContext` checks CF
  Access first when `SITE_ADMIN_AUTH_MODE !== "legacy"`.

### Env toggle

```
SITE_ADMIN_AUTH_MODE=both        # default: try CF Access, fall back to legacy
SITE_ADMIN_AUTH_MODE=cf-access   # accept ONLY CF Access (NextAuth ignored)
SITE_ADMIN_AUTH_MODE=legacy      # skip CF Access path entirely
```

### Required CF Access env (staging and prod)

```
CF_ACCESS_TEAM_DOMAIN=jinnkunn.cloudflareaccess.com
CF_ACCESS_AUD=<application AUD from CF dashboard>
SITE_ADMIN_EMAILS=i@jinkunchen.com,alice@example.com
SITE_ADMIN_SERVICE_TOKENS=tauri-workspace.service.jinkunchen.com
```

- `CF_ACCESS_AUD` is the Application AUD tag (Zero Trust → Access → Applications → application → Overview → AUD). Long hex string.
- `SITE_ADMIN_EMAILS` is the allow-list of user emails (case-insensitive).
- `SITE_ADMIN_SERVICE_TOKENS` is the allow-list of service-token
  `common_name` values. A service token's `common_name` is displayed in the
  CF dashboard when you create the token; it looks like
  `my-token.<team-id>.access`.

## Phase 2 — cut-over (not yet done)

1. Ensure staging app works end-to-end with `SITE_ADMIN_AUTH_MODE=cf-access`.
2. Copy-proof: create a CF Access service token for the Tauri desktop app
   (Zero Trust → Access → Service Auth → Service Tokens → **Create Service
   Token**). Store the `Client ID` + `Client Secret` in the macOS Keychain
   via the workspace app's connection card (pending Tauri-side change —
   see Phase 3).
3. Flip prod to `SITE_ADMIN_AUTH_MODE=cf-access` after one full business
   week with no auth failures on the CF path in staging.
4. Delete: `/api/auth/[...nextauth]/route.ts`, `site-admin/login/*`, the
   `SiteAdminLoginClient`, `next-auth` dep, `GITHUB_ID/GITHUB_SECRET/NEXTAUTH_URL/NEXTAUTH_SECRET`
   env, and `getSiteAdminGithubLogin` + bearer-token paths in
   `requireSiteAdminContext`.

## Phase 3 — Tauri side

Pending. The workspace Rust command currently mints and stores a long-lived
HMAC bearer token. After Phase 2 that token infrastructure becomes dead
code. Replacement:

- Connection card: user pastes `CF-Access-Client-Id` + `CF-Access-Client-Secret`
  (one-time, from CF dashboard), we store both in Keychain.
- Each HTTP request from Tauri attaches both headers. CF Access validates
  at the edge, converts to a signed JWT, our Worker verifies the JWT.
- Fallback to browser-based user login when no service token is
  configured: CF Access redirects to the team IdP in the system browser,
  user completes the flow, CF sets `CF_Authorization` cookie on the
  workspace origin, Tauri captures the cookie via loopback (similar to
  today's flow) and attaches it on subsequent requests. This path is
  optional once service tokens are set up.

## Rollback plan

- Set `SITE_ADMIN_AUTH_MODE=legacy` and redeploy. All CF Access paths are
  skipped, behavior reverts to NextAuth + HMAC bearer tokens.
- No data migration is needed — we never removed the legacy code in
  Phase 1.
- CF Access dashboard state can stay in place; with `legacy` mode the
  worker ignores the JWT header.

## Testing

- `tests/cloudflare-access-auth.test.mjs` — 9 unit tests covering signature
  verification, `iss`/`aud`/`exp` validation, JWKS caching, and both user /
  service-token identity shapes. Uses `crypto.generateKeyPairSync` + a
  stubbed global `fetch` to mock the JWKS endpoint.
- Before flipping to `cf-access` mode in a given environment, exercise an
  end-to-end flow against the staging origin with the dashboard enabled.
