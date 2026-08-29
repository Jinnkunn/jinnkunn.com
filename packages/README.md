# Shared application packages

These private packages are the canonical cross-client implementation layer for
the public Web app, Site Admin, the Tauri workspace, and the Workspace MCP
server.

- `@jinnkunn/calendar-core`: calendar normalization, timezone, tags, public
  projection, and ICS generation. It must stay platform independent.
- `@jinnkunn/contracts`: wire types, command parsers, and runtime schemas. It
  may depend on `calendar-core`, but not on React, Next, Tauri, or Node APIs.
- `@jinnkunn/content-core`: content metadata and Home/Now/component
  normalization. It may depend on `contracts`.
- `@jinnkunn/document-repository`: versioned, content-root-relative document
  storage contract shared by filesystem, D1, and remote API adapters.
- `@jinnkunn/site-admin-client`: Site Admin response contracts, transport
  decoding, and the fetch client. It may depend on the packages above.

Import the narrow package subpath that owns the behavior. Files under the old
`lib/shared`, `lib/pages`, `lib/posts`, and `lib/site-admin` paths are temporary
compatibility facades only; do not add implementation logic to them.
