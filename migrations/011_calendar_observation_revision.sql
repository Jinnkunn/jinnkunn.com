-- One staging revision per committed observation snapshot. Live stores the
-- staging revision it has mirrored; a NULL updated_at marks legacy rows.
CREATE TABLE IF NOT EXISTS calendar_observation_revision (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  revision    INTEGER NOT NULL CONSTRAINT calendar_observation_revision_guard CHECK (revision >= 0),
  updated_at  TEXT
);

INSERT OR IGNORE INTO calendar_observation_revision (id, revision)
VALUES (1, 0);
