# Workspace Credential Storage

The Tauri workspace exposes three credential commands to the webview:

- `secure_store_get`
- `secure_store_set`
- `secure_store_delete`

## Stored Values

The Site Admin module is the only current consumer. Keys are namespaced with
`site-admin:` and include:

- `site-admin:token::<base-url>` — Site Admin browser-login app token
- `site-admin:cf-access-id::<base-url>` — Cloudflare Access client id
- `site-admin:cf-access-secret::<base-url>` — Cloudflare Access client secret

Calendar public sync reads those same Site Admin credentials when it publishes
calendar data. Notes, Todos, Projects, Contacts, and local calendar rows do not
store their own secrets.

## Backend Selection

Production builds default to macOS Keychain through the `keyring` crate.
Debug builds default to the local `workspace.db` table `secure_values`, which
avoids repeated Keychain permission prompts during development and testing.

Override at runtime:

```bash
WORKSPACE_SECRET_BACKEND=keychain npm run workspace:tauri:dev
WORKSPACE_SECRET_BACKEND=local-db npm run workspace:tauri:dev
```

## Tradeoff

`local-db` is intentionally a development convenience. Values are local-only
and never synced, but they are stored as plaintext in `workspace.db`. Use
`keychain` for production or for any build where OS-level credential protection
matters.
