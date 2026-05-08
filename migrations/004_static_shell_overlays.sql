-- Content-only publishing overlay for prerendered public HTML shells.
-- The Worker checks this table before falling back to bundled ASSETS, so
-- article/news/page text can update without deploying a new Worker version.

CREATE TABLE IF NOT EXISTS static_shell_overlays (
  asset_path    TEXT PRIMARY KEY, -- e.g. "/__static/news.html"
  body          TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'text/html; charset=utf-8',
  content_sha   TEXT NOT NULL,
  source_sha    TEXT,
  source_branch TEXT,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_static_shell_overlays_updated_at
  ON static_shell_overlays (updated_at DESC);

CREATE TABLE IF NOT EXISTS static_shell_overlay_snapshots (
  id            TEXT PRIMARY KEY,
  env           TEXT NOT NULL,
  snapshot_sha  TEXT NOT NULL,
  source_sha    TEXT,
  source_branch TEXT,
  file_count    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  note          TEXT
);

CREATE INDEX IF NOT EXISTS idx_static_shell_overlay_snapshots_created_at
  ON static_shell_overlay_snapshots (created_at DESC);

CREATE TABLE IF NOT EXISTS static_shell_overlay_versions (
  snapshot_id   TEXT NOT NULL,
  asset_path    TEXT NOT NULL,
  body          TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  content_sha   TEXT NOT NULL,
  source_sha    TEXT,
  source_branch TEXT,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, asset_path)
);

CREATE INDEX IF NOT EXISTS idx_static_shell_overlay_versions_snapshot_id
  ON static_shell_overlay_versions (snapshot_id);
