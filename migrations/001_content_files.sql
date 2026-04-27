-- Initial schema for the libSQL/Turso ContentStore backend.
-- Mirrors the file-blob shape of lib/server/content-store.ts so the existing
-- if-match / sha contract translates 1:1 to row-level optimistic locking.

CREATE TABLE IF NOT EXISTS content_files (
  rel_path     TEXT PRIMARY KEY,                        -- e.g. "posts/foo.mdx"
  body         BLOB NOT NULL,                           -- text and binary alike
  is_binary    INTEGER NOT NULL DEFAULT 0,
  sha          TEXT NOT NULL,                           -- sha1(body), opaque version
  size         INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,                        -- unix milliseconds
  updated_by   TEXT                                     -- github login or system actor
);

-- Recently-changed scans (e.g. dump-from-db prebuild) sort by updated_at DESC.
CREATE INDEX IF NOT EXISTS idx_content_files_updated_at
  ON content_files (updated_at DESC);
