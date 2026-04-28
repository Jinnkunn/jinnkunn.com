-- Append-only history of every content_files write. Powers the Versions
-- panel + restore flow (/api/site-admin/versions) in db mode where the
-- local-fs path used `git log -- <file>` and the github path used the
-- repo's commit timeline.
--
-- Every successful upsert in lib/server/db-content-store.ts inserts one
-- row here. No-op writes (sha unchanged) are skipped, so the table only
-- grows when content actually changes.
--
-- "commitSha" in the SiteAdminFileHistoryEntry contract is the body sha
-- (sha1 of bytes) since there's no git commit to point at — this is the
-- same value the file-level optimistic-lock uses, so listFileHistory()
-- and readFileAtSha() share one identifier across the API surface.

CREATE TABLE IF NOT EXISTS content_files_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_path     TEXT NOT NULL,
  body         BLOB NOT NULL,
  is_binary    INTEGER NOT NULL DEFAULT 0,
  sha          TEXT NOT NULL,                    -- sha1(body), == commitSha in db mode
  size         INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,                 -- unix milliseconds
  updated_by   TEXT
);

-- Versions panel queries by (rel_path) ORDER BY updated_at DESC LIMIT N;
-- restore POSTs query by (rel_path, sha). Single composite index covers
-- both with one B-tree.
CREATE INDEX IF NOT EXISTS idx_content_files_history_rel_path_updated
  ON content_files_history (rel_path, updated_at DESC);
