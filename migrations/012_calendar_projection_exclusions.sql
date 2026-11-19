-- Keep verified supersession separate from observation deletion. A legacy
-- collector replay or a shrinking capture window must not revive these copies.
CREATE TABLE IF NOT EXISTS calendar_projection_exclusions (
  id              TEXT PRIMARY KEY,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  is_all_day      INTEGER NOT NULL CHECK (is_all_day IN (0, 1)),
  legacy_ids_json TEXT NOT NULL CHECK (json_valid(legacy_ids_json) AND json_type(legacy_ids_json) = 'array'),
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_projection_exclusions_range
  ON calendar_projection_exclusions (starts_at, ends_at);
