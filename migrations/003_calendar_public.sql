-- Public calendar projection tables. These store only the sanitized
-- visitor-facing event projection, never raw macOS/EventKit details.

CREATE TABLE IF NOT EXISTS calendar_public_events (
  id          TEXT PRIMARY KEY,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  body_json   TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_public_events_starts_at
  ON calendar_public_events (starts_at);

CREATE TABLE IF NOT EXISTS calendar_public_sync_state (
  id              TEXT PRIMARY KEY,
  generated_at    TEXT NOT NULL,
  range_starts_at TEXT NOT NULL,
  range_ends_at   TEXT NOT NULL,
  event_count     INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
