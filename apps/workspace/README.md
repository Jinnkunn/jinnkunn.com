# Workspace App (Tauri v1)

Desktop client for the existing Site Admin APIs.

## Scope

- Reuses current backend endpoints without protocol changes:
  - `GET /api/site-admin/status`
  - `GET/POST /api/site-admin/config`
  - `GET/POST /api/site-admin/routes`
  - `POST /api/site-admin/deploy`
- Keeps strict semantics:
  - `Save` writes source branch.
  - `Deploy` is separate publish action.
- Supports optimistic concurrency:
  - Uses `sourceVersion` from GET payloads.
  - Handles `409 + SOURCE_CONFLICT` by locking save and requiring reload.

## Current UI

- `Status` tab:
  - Source head/branch, pending deploy, deploy trigger.
- `Config` tab:
  - Site settings edit/save.
  - Navigation row update/create.
- `Routes` tab:
  - Override update/create.
  - Protected route update/create.

## Local Run

```bash
cd apps/workspace
npm install
npm run tauri:dev
```

Build frontend only:

```bash
npm run build
```

## Auth

- Uses browser-mediated login flow:
  1. Click `Sign In With Browser`.
  2. Complete `/site-admin/login` in browser.
  3. Browser redirects back to local callback and app receives short-lived bearer token.
- App token is stored in OS secure storage (Keychain/Credential Manager/libsecret) via Rust `keyring`.
- Local storage only keeps non-secret metadata (`baseUrl`, login, expiry hint) under `workspace.site-admin.connection.v1`.
