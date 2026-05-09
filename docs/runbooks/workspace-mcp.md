# Workspace MCP

The Workspace MCP server is a local-only automation layer for the Tauri
workspace. It exposes structured tools over stdio so an AI client can operate
Notes, Todos, Projects, Contacts, and the local Workspace calendar without
clicking through the UI.

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

Override it for testing or sandboxed clients:

```bash
WORKSPACE_DB_PATH=/tmp/workspace.db npm run workspace:mcp
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
- Site Admin is read-only in v1. `siteAdmin.release_status` reports release
  state but cannot deploy staging or promote production.
- Local write tools support `dryRun: true` and return the row that would be
  created or changed.
- Set `WORKSPACE_MCP_READONLY=1` to block all write tools.
- Write tools append local audit entries to `.cache/workspace-mcp/audit.jsonl`.

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

## Resources

- `workspace://schema`
- `workspace://context`
- `workspace://recent`

## Current Scope

MCP v1 directly uses the local SQLite schema. It is intentionally limited to
low-risk local-first operations plus read-only release status. macOS EventKit
calendar accounts and production release actions should stay behind explicit
Tauri UI confirmation until a later version adds a first-class permission
prompt.
