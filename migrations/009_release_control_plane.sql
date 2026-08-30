-- Release control plane: cross-process release locks + durable release history.
-- Both tables live in the shared staging control-plane database (the same D1
-- that hosts release_jobs), so every machine that can deploy sees the same
-- lock state and the same audit trail. scripts/_lib/release-control-plane.mjs
-- also ensures these tables on first use; this file keeps the schema in the
-- canonical migrations path.

CREATE TABLE IF NOT EXISTS release_locks (
  environment  TEXT PRIMARY KEY,
  holder       TEXT NOT NULL,
  operation    TEXT,
  acquired_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS release_history (
  id                   TEXT PRIMARY KEY,
  recorded_at          INTEGER NOT NULL,
  source               TEXT NOT NULL,
  env                  TEXT NOT NULL,
  ok                   INTEGER NOT NULL DEFAULT 1,
  sha                  TEXT,
  branch               TEXT,
  deployed_version_id  TEXT,
  deployment_id        TEXT,
  note                 TEXT,
  detail_json          TEXT
);

CREATE INDEX IF NOT EXISTS idx_release_history_recorded
  ON release_history (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_release_history_env_recorded
  ON release_history (env, recorded_at DESC);
