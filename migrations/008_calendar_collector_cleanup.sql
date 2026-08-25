-- Collector-scoped snapshot reconciliation and cleanup query by collector,
-- active/tombstoned state, and overlapping event range. This is a separate
-- migration because deployed databases may already have applied 007.

CREATE INDEX IF NOT EXISTS idx_calendar_event_observations_collector_range
  ON calendar_event_observations (collector_id, deleted_at, starts_at, ends_at);
