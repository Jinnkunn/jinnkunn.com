-- Remote release runner heartbeat state.
-- Agents update this table every poll so Release Center can show whether a
-- remote machine is online before the user queues a publish job.

CREATE TABLE IF NOT EXISTS release_agents (
  agent_id          TEXT PRIMARY KEY,
  status            TEXT NOT NULL,
  current_job_id    TEXT,
  capabilities_json TEXT,
  last_seen_at      INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_release_agents_seen
  ON release_agents (last_seen_at DESC);
