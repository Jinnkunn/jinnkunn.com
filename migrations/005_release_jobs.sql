-- Remote release control-plane queue.
-- Release agents poll this table over HTTPS and execute jobs from a trusted
-- machine without exposing that machine directly to the public internet.

CREATE TABLE IF NOT EXISTS release_jobs (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL,
  script        TEXT NOT NULL,
  target        TEXT NOT NULL,
  status        TEXT NOT NULL,
  actor         TEXT NOT NULL,
  agent_id      TEXT,
  phase         TEXT,
  request_json  TEXT,
  result_json   TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  claimed_at    INTEGER,
  started_at    INTEGER,
  finished_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_release_jobs_status_created
  ON release_jobs (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_release_jobs_updated
  ON release_jobs (updated_at DESC);

CREATE TABLE IF NOT EXISTS release_job_events (
  id       TEXT PRIMARY KEY,
  job_id   TEXT NOT NULL,
  seq      INTEGER NOT NULL,
  at       INTEGER NOT NULL,
  phase    TEXT NOT NULL,
  stream   TEXT NOT NULL,
  message  TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES release_jobs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_release_job_events_job_seq
  ON release_job_events (job_id, seq);

