-- A Cloudflare Worker version and its independently published content.
-- Rows in static_shell_overlay_versions are immutable after preparation.
CREATE TABLE IF NOT EXISTS static_shell_overlay_active (
  worker_version_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  previous_snapshot_id TEXT,
  updated_at INTEGER NOT NULL
);
