# Workspace App (Tauri v1)

Desktop client for the existing Site Admin APIs. The app is the daily editing
surface for the personal site; staging is the default target and production
promotion remains a guarded release step.

## Scope

- Reuses current backend endpoints without protocol changes:
  - `GET /api/site-admin/status`
  - `GET/POST /api/site-admin/config`
  - `GET/POST /api/site-admin/routes`
  - `GET/POST /api/site-admin/home`
  - `GET/POST/PATCH/DELETE /api/site-admin/posts`
  - `GET/POST/PATCH/DELETE /api/site-admin/pages`
  - `GET/POST /api/site-admin/pages/tree`
  - `POST /api/site-admin/deploy`
- Keeps strict semantics:
  - `Save` writes source branch.
  - `Deploy` is separate publish action.
- Supports optimistic concurrency:
  - Uses `sourceVersion` from GET payloads.
  - Handles `409 + SOURCE_CONFLICT` by locking save and requiring reload.

## Current UI

- `Home` tab:
  - Shared MDX document editor writing `content/home.json` as title + bodyMdx.
- `Blog` / `Pages` tabs:
  - Notion-style block editor with Source and Preview modes.
  - Sidebar-driven page tree with persisted page order.
- `Components` tab:
  - Edits reusable MDX component documents.
- `Status` tab:
  - Source head/branch, pending deploy, deploy trigger.
- `Settings` tab:
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

## First-Party Modules

Workspace features such as Site Admin, Calendar, Notes, and Todos are bundled
first-party modules registered through `src/modules/registry.tsx`. New daily
tools should follow the scaffold in `templates/workspace-module/` so the shell
continues to own discovery, module enablement, recent items, favorites, tabs,
and command palette wiring.

## Auth

- Uses browser-mediated login flow:
  1. Click `Sign In With Browser`.
  2. Complete `/site-admin/login` in browser.
  3. Browser redirects back to local callback and app receives short-lived bearer token.
- App token is stored in OS secure storage (Keychain/Credential Manager/libsecret) via Rust `keyring`.
- Local storage only keeps non-secret metadata (`baseUrl`, login, expiry hint) under `workspace.site-admin.connection.v1`.
