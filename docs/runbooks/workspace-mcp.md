# Workspace MCP

The Workspace MCP server is a local-only automation layer for the Tauri
workspace. It exposes structured tools over stdio so an AI client can operate
Notes, Todos, Projects, Contacts, Site Admin content, and the local Workspace
calendar without clicking through the UI.

## Run

```bash
npm run workspace:mcp
```

For a quick local health check:

```bash
npm run workspace:mcp:self-test
```

By default the server opens the same local database as the Tauri app:

```text
~/Library/Application Support/com.jinnkunn.workspace/workspace.db
```

It also reads settings and writes audit entries in the same app data folder:

```text
~/Library/Application Support/com.jinnkunn.workspace/mcp-settings.json
~/Library/Application Support/com.jinnkunn.workspace/mcp-audit.jsonl
~/Library/Application Support/com.jinnkunn.workspace/mcp-confirmations.json
~/Library/Application Support/com.jinnkunn.workspace/site-admin-content-publish-suggestion.json
```

Override it for testing or sandboxed clients:

```bash
WORKSPACE_DB_PATH=/tmp/workspace.db npm run workspace:mcp
```

Headless confirmation helpers:

```bash
npm run workspace:mcp:confirmations
npm run workspace:mcp:approve -- <confirmation-id>
npm run workspace:mcp:reject -- <confirmation-id>
```

## Client Config

Use stdio transport and point the command at this repo:

```json
{
  "mcpServers": {
    "jinnkunn-workspace": {
      "command": "npm",
      "args": ["run", "workspace:mcp"],
      "cwd": "/Users/jinnkunn/Desktop/jinnkunn.com"
    }
  }
}
```

## Safety Model

- The server listens only on stdio. It does not expose an HTTP port.
- Site Admin write access defaults to the staging Site Admin API
  (`https://staging.jinkunchen.com`). When the app has a saved staging Site
  Admin token in the local credential store, `siteAdmin.create_page`,
  `siteAdmin.update_page`, and `siteAdmin.delete_page` write to staging D1 so
  the page appears in Site Admin immediately. Local `content/pages` writes are
  kept as fallback/recovery.
- Site Admin content writes create
  `site-admin-content-publish-suggestion.json`; Release Center reads it and
  suggests the next content publish step.
- `siteAdmin.release_status` reports release state but cannot deploy staging or
  promote production.
- Local write tools support `dryRun: true` and return the row that would be
  created or changed.
- Workspace Settings → AI Access writes `mcp-settings.json`, which the MCP
  server reads at tool-call time.
- By default, write tools create a pending confirmation in
  `mcp-confirmations.json`. Approve it in Workspace Settings → AI Access, then
  retry the same MCP tool call with the returned `confirmationId`.
- Set `WORKSPACE_MCP_READONLY=1` to force read-only mode regardless of the
  saved Workspace setting.
- Write tools append local audit entries to `mcp-audit.jsonl`.

Default permissions:

```json
{
  "enabled": true,
  "writeMode": "local-write",
  "requireConfirmationForWrites": true,
  "allowNotesWrite": true,
  "allowTodosWrite": true,
  "allowProjectsWrite": true,
  "allowSiteAdminWrite": true,
  "siteAdminWriteTarget": "api",
  "siteAdminBaseUrl": "https://staging.jinkunchen.com",
  "siteAdminFallbackToLocal": true,
  "allowCalendarWrite": false
}
```

Site Admin API credentials are resolved in this order:

1. `WORKSPACE_MCP_SITE_ADMIN_AUTH_TOKEN`
2. The app's local credential DB entry for the configured Site Admin base URL
3. Local content fallback, when `siteAdminFallbackToLocal` is enabled

Use `WORKSPACE_MCP_SITE_ADMIN_BACKEND=local` or set AI Access → Site Admin
target to `Local files` for recovery workflows that intentionally edit the
repository content tree.

## Tools

- `workspace.get_context`
- `workspace.search`
- `notes.get_page`
- `notes.create_page`
- `notes.append_blocks`
- `todos.create`
- `todos.update`
- `todos.complete`
- `projects.get`
- `projects.create`
- `projects.add_link`
- `contacts.get`
- `calendar.list_events`
- `calendar.create_event`
- `siteAdmin.release_status`
- `siteAdmin.list_pages`
- `siteAdmin.get_page`
- `siteAdmin.create_page`
- `siteAdmin.update_page`
- `siteAdmin.delete_page`

## Resources

- `workspace://schema`
- `workspace://context`
- `workspace://recent`

## Current Scope

MCP v1 directly uses the local SQLite schema for Workspace data. Site Admin
page authoring writes through the staging Site Admin API when credentials are
available, falling back to the local `content/` tree only for recovery/offline
workflows. macOS EventKit calendar accounts and production release actions
should stay behind explicit Tauri UI confirmation until a later version adds a
first-class permission prompt.
