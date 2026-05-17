-- Multi-device calendar sync foundation.
--
-- calendar_public_events remains the visitor-facing projection. These tables
-- keep source-aware observations so multiple collectors (macOS, iOS, server
-- connectors) can report what they see without overwriting each other.

CREATE TABLE IF NOT EXISTS calendar_sync_sources (
  id                 TEXT PRIMARY KEY,
  provider           TEXT NOT NULL,
  title              TEXT NOT NULL,
  account_key         TEXT,
  external_source_id  TEXT,
  collector_id        TEXT NOT NULL,
  sync_scope_json     TEXT NOT NULL DEFAULT '{}',
  last_synced_at      TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_sources_provider
  ON calendar_sync_sources (provider);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_sources_collector
  ON calendar_sync_sources (collector_id);

CREATE TABLE IF NOT EXISTS calendar_event_observations (
  observation_id          TEXT PRIMARY KEY,
  entity_id               TEXT,
  source_id               TEXT NOT NULL,
  collector_id            TEXT NOT NULL,
  source_event_id          TEXT,
  ical_uid                TEXT,
  recurrence_instance_id  TEXT,
  starts_at               TEXT NOT NULL,
  ends_at                 TEXT NOT NULL,
  last_seen_at            TEXT NOT NULL,
  deleted_at              TEXT,
  body_json               TEXT NOT NULL,
  updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_observations_source_range
  ON calendar_event_observations (source_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_calendar_event_observations_entity
  ON calendar_event_observations (entity_id);

CREATE INDEX IF NOT EXISTS idx_calendar_event_observations_active_range
  ON calendar_event_observations (deleted_at, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS calendar_event_entities (
  entity_id   TEXT PRIMARY KEY,
  dedupe_key  TEXT NOT NULL,
  title       TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  body_json   TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_entities_range
  ON calendar_event_entities (starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_calendar_event_entities_dedupe_key
  ON calendar_event_entities (dedupe_key);

CREATE TABLE IF NOT EXISTS calendar_sync_state (
  id               TEXT PRIMARY KEY,
  collector_id     TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  sync_mode        TEXT NOT NULL,
  range_starts_at  TEXT NOT NULL,
  range_ends_at    TEXT NOT NULL,
  event_count      INTEGER NOT NULL,
  synced_at        TEXT NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_state_source
  ON calendar_sync_state (source_id, synced_at);
