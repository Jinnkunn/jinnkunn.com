// Local SQLite mirror of the D1 content_files table. Used by the sync
// engine (sync.rs) to cache rows on the user's machine so the React
// editor can read instantly + offline.
//
// Phase 5a scope: read cache only. The schema mirrors content_files
// from migrations/001_content_files.sql so server-side rows can be
// `INSERT OR REPLACE`'d in directly without translation.
//
// Connection lifecycle: opened per command call. SQLite open is
// microseconds and `Connection` is `!Send`, so passing it around via
// `tauri::State` would force us into `Mutex<Connection>` plus careful
// poisoning handling. Per-call open keeps every Tauri command a clean
// "open → query → drop" with no shared state to debug.

use rusqlite::{params, Connection};
use std::path::PathBuf;
use tauri::Manager;

const DB_FILENAME: &str = "workspace.db";

/// File-backed local DB path, e.g. on macOS:
/// `~/Library/Application Support/com.jinnkunn.workspace/workspace.db`
pub fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("failed to create app data dir {}: {err}", dir.display()))?;
    Ok(dir.join(DB_FILENAME))
}

pub fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path)
        .map_err(|err| format!("failed to open local DB at {}: {err}", path.display()))?;
    // Foreign keys aren't strictly needed today, but enabling them now
    // means a future history-tracking schema change won't silently let
    // orphan rows accumulate.
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|err| format!("failed to enable FK pragma: {err}"))?;
    run_migrations(&conn)?;
    Ok(conn)
}

/// Apply the local schema. Idempotent — `CREATE TABLE IF NOT EXISTS` so
/// the same Tauri build can run against an existing DB or a fresh one.
pub(crate) fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        -- Mirror of D1 `content_files`. Same columns + types so we can
        -- INSERT OR REPLACE rows from /api/site-admin/sync/pull straight
        -- through without translation.
        CREATE TABLE IF NOT EXISTS content_files (
            rel_path     TEXT PRIMARY KEY,
            body         BLOB NOT NULL,
            is_binary    INTEGER NOT NULL DEFAULT 0,
            sha          TEXT NOT NULL,
            size         INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL,
            updated_by   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_content_files_updated_at
            ON content_files (updated_at DESC);

        -- Generic key/value store for sync watermarks + future flags.
        -- Currently holds:
        --   `last_sync_since` -> highest updated_at successfully pulled.
        --   `last_sync_at`    -> wall-clock unix ms of the last successful pull.
        CREATE TABLE IF NOT EXISTS sync_state (
            key   TEXT PRIMARY KEY,
            value INTEGER NOT NULL
        );

        -- Per-calendar-event public publishing rules. This stores only
        -- disclosure policy and public overrides, never raw EventKit
        -- notes/location/details by default.
        CREATE TABLE IF NOT EXISTS calendar_publish_rules (
            event_key     TEXT PRIMARY KEY,
            metadata_json TEXT NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_publish_rules_updated_at
            ON calendar_publish_rules (updated_at DESC);

        -- Phase 5b — write outbox. Mutating site-admin requests
        -- (PUT/POST/DELETE) that fail with a network-level error are
        -- captured here so a brief offline window (flight, spotty
        -- wifi, server bounce) doesn't lose work. The drain command
        -- replays each entry against the same endpoint; on success
        -- the row is deleted, on a server-side error (4xx/5xx) the
        -- attempts counter + last_error are bumped for the UI to
        -- surface. The body is stored as raw JSON bytes so the entry
        -- works for arbitrary site-admin endpoints, not just content
        -- writes — calendar publish rules, deploy hooks, anything
        -- routed through site_admin_http_request can land here.
        CREATE TABLE IF NOT EXISTS write_outbox (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            base_url      TEXT NOT NULL,
            path          TEXT NOT NULL,
            method        TEXT NOT NULL,
            body_json     TEXT NOT NULL,        -- empty string when body is null
            enqueued_at   INTEGER NOT NULL,
            attempts      INTEGER NOT NULL DEFAULT 0,
            last_error    TEXT,                 -- null until first failed retry
            last_attempt  INTEGER                -- unix ms; null until first attempt
        );
        CREATE INDEX IF NOT EXISTS idx_write_outbox_enqueued
            ON write_outbox (enqueued_at);

        -- Local-first Notes surface. These rows are intentionally not
        -- mirrored to the website/content branch in v1; they live only
        -- in the workspace.db file and use archive semantics instead of
        -- hard delete so accidental removals can be recovered later.
        CREATE TABLE IF NOT EXISTS notes (
            id          TEXT PRIMARY KEY,
            parent_id   TEXT REFERENCES notes(id) ON DELETE SET NULL,
            title       TEXT NOT NULL,
            body_mdx    TEXT NOT NULL DEFAULT '',
            icon        TEXT,
            sort_order  INTEGER NOT NULL,
            archived_at INTEGER,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_parent_order
            ON notes (parent_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_notes_updated_at
            ON notes (updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notes_title
            ON notes (title);

        -- Local-first Todos module. These rows stay in workspace.db
        -- alongside notes and use archive semantics so clearing a task
        -- does not physically delete it from the local store.
        CREATE TABLE IF NOT EXISTS todos (
            id                 TEXT PRIMARY KEY,
            title              TEXT NOT NULL,
            notes              TEXT NOT NULL DEFAULT '',
            due_at             INTEGER,
            scheduled_start_at INTEGER,
            scheduled_end_at   INTEGER,
            estimated_minutes  INTEGER,
            sort_order         INTEGER NOT NULL,
            completed_at       INTEGER,
            archived_at        INTEGER,
            created_at         INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_todos_status_due_order
            ON todos (archived_at, completed_at, due_at, sort_order);
        CREATE INDEX IF NOT EXISTS idx_todos_updated_at
            ON todos (updated_at DESC);

        -- Personal CRM. Local-first contact records — names, contact
        -- methods, birthdays, free-form Markdown notes, and tags. Rows
        -- live entirely in workspace.db and use archive semantics so
        -- accidental deletion is recoverable. Multi-valued contact
        -- methods (multiple emails / phones) are stored as JSON arrays
        -- to keep the schema flat while still allowing the frontend
        -- to render labelled rows like "work" / "personal".
        CREATE TABLE IF NOT EXISTS contacts (
            id              TEXT PRIMARY KEY,
            display_name    TEXT NOT NULL,
            given_name      TEXT,
            family_name     TEXT,
            company         TEXT,
            role            TEXT,
            -- Birthday: month+day always present together when set,
            -- year is independently optional (some birthdays are
            -- known to the day but not the year).
            birthday_month  INTEGER,
            birthday_day    INTEGER,
            birthday_year   INTEGER,
            -- emails_json/phones_json store [{value, label, primary}].
            -- The first entry doubles as the primary when no item is
            -- explicitly flagged.
            emails_json     TEXT NOT NULL DEFAULT '[]',
            phones_json     TEXT NOT NULL DEFAULT '[]',
            tags_json       TEXT NOT NULL DEFAULT '[]',
            notes           TEXT NOT NULL DEFAULT '',
            -- Personal CRM follow-up workflow. `next_follow_up_at`
            -- is a unix-ms due date; `cadence_days` auto-schedules
            -- the next touch after a logged interaction.
            next_follow_up_at INTEGER,
            cadence_days      INTEGER,
            -- Pinned contacts float to the top of "All" / "Recent".
            pinned_at       INTEGER,
            archived_at     INTEGER,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_updated_at
            ON contacts (archived_at, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_contacts_birthday
            ON contacts (archived_at, birthday_month, birthday_day);

        -- Interaction log. One row per touchpoint (meeting, call,
        -- message, freeform note). The most recent row's `occurred_at`
        -- is treated as the contact's "last met" timestamp at query
        -- time — no denormalised cache needed for typical contact
        -- counts. `source` is reserved for cross-references like
        -- "calendar:eventId" so a future auto-derive pass can dedupe.
        CREATE TABLE IF NOT EXISTS contact_interactions (
            id           TEXT PRIMARY KEY,
            contact_id   TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            occurred_at  INTEGER NOT NULL,
            kind         TEXT NOT NULL,
            note         TEXT NOT NULL DEFAULT '',
            source       TEXT,
            created_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contact_interactions_recent
            ON contact_interactions (contact_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_contact_interactions_global_recent
            ON contact_interactions (occurred_at DESC);

        -- Trigram FTS5 index for the contacts search box. Same tokenizer
        -- choice as notes_fts so CJK substring queries work the same way.
        CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
            display_name,
            given_name,
            family_name,
            company,
            role,
            notes,
            content='contacts',
            content_rowid='rowid',
            tokenize='trigram case_sensitive 0'
        );
        CREATE TRIGGER IF NOT EXISTS contacts_fts_ai AFTER INSERT ON contacts BEGIN
            INSERT INTO contacts_fts(rowid, display_name, given_name, family_name, company, role, notes)
            VALUES (new.rowid, new.display_name, new.given_name, new.family_name, new.company, new.role, new.notes);
        END;
        CREATE TRIGGER IF NOT EXISTS contacts_fts_ad AFTER DELETE ON contacts BEGIN
            INSERT INTO contacts_fts(contacts_fts, rowid, display_name, given_name, family_name, company, role, notes)
            VALUES ('delete', old.rowid, old.display_name, old.given_name, old.family_name, old.company, old.role, old.notes);
        END;
        CREATE TRIGGER IF NOT EXISTS contacts_fts_au AFTER UPDATE ON contacts BEGIN
            INSERT INTO contacts_fts(contacts_fts, rowid, display_name, given_name, family_name, company, role, notes)
            VALUES ('delete', old.rowid, old.display_name, old.given_name, old.family_name, old.company, old.role, old.notes);
            INSERT INTO contacts_fts(rowid, display_name, given_name, family_name, company, role, notes)
            VALUES (new.rowid, new.display_name, new.given_name, new.family_name, new.company, new.role, new.notes);
        END;

        -- Backlinks from notes to contacts. Populated automatically
        -- whenever a note is created or updated — the resolver scans
        -- the body for `@<contact name>` substrings and writes one row
        -- per (note, contact, offset) match. The contact CRM uses this
        -- to render a "Mentioned in N notes" panel; deleting a contact
        -- cascades to drop their backlinks. Both edges are foreign-key
        -- checked so an archived note (kept for recovery) keeps its
        -- mentions until the source row goes away.
        CREATE TABLE IF NOT EXISTS note_contact_mentions (
            note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            contact_id   TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            mention_text TEXT NOT NULL,
            char_offset  INTEGER NOT NULL,
            created_at   INTEGER NOT NULL,
            PRIMARY KEY (note_id, contact_id, char_offset)
        );
        CREATE INDEX IF NOT EXISTS idx_note_contact_mentions_by_contact
            ON note_contact_mentions (contact_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_note_contact_mentions_by_note
            ON note_contact_mentions (note_id);

        -- Local-first workspace calendar. These rows describe a self-
        -- contained calendar (and its events) that lives entirely in
        -- workspace.db — no EventKit dependency. The frontend renders
        -- them alongside macOS Calendar sources under a synthetic
        -- "Workspace" account header so the operator gets one unified
        -- calendar surface. Archive semantics (no hard delete) match
        -- the rest of the local-first surfaces.
        CREATE TABLE IF NOT EXISTS local_calendars (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            color_hex    TEXT NOT NULL,
            sort_order   INTEGER NOT NULL,
            archived_at  INTEGER,
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_local_calendars_sort
            ON local_calendars (archived_at, sort_order);

        CREATE TABLE IF NOT EXISTS local_calendar_events (
            id            TEXT PRIMARY KEY,
            calendar_id   TEXT NOT NULL REFERENCES local_calendars(id) ON DELETE CASCADE,
            title         TEXT NOT NULL,
            notes         TEXT,
            location      TEXT,
            url           TEXT,
            -- Unix milliseconds. The bridge re-projects to ISO 8601 with
            -- offset on read so the frontend's `CalendarEvent` shape stays
            -- uniform between EventKit and local sources.
            starts_at_ms  INTEGER NOT NULL,
            ends_at_ms    INTEGER NOT NULL,
            is_all_day    INTEGER NOT NULL DEFAULT 0,
            archived_at   INTEGER,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_local_calendar_events_range
            ON local_calendar_events (calendar_id, archived_at, starts_at_ms);
        CREATE INDEX IF NOT EXISTS idx_local_calendar_events_window
            ON local_calendar_events (archived_at, starts_at_ms, ends_at_ms);

        -- Phase 6 — full-text index for the Notes search box. Trigram
        -- tokenizer gives substring matches that work for both Latin
        -- and CJK input (no whitespace tokenizer would catch "笔记"
        -- as a single token). External-content table mode lets the
        -- triggers below keep notes_fts in sync without duplicating
        -- the body text.
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title,
            body_mdx,
            content='notes',
            content_rowid='rowid',
            tokenize='trigram case_sensitive 0'
        );
        CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, body_mdx)
            VALUES (new.rowid, new.title, new.body_mdx);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, body_mdx)
            VALUES ('delete', old.rowid, old.title, old.body_mdx);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, body_mdx)
            VALUES ('delete', old.rowid, old.title, old.body_mdx);
            INSERT INTO notes_fts(rowid, title, body_mdx)
            VALUES (new.rowid, new.title, new.body_mdx);
        END;
        "#,
    )
    .map_err(|err| format!("failed to run local DB migrations: {err}"))?;

    ensure_todos_column(conn, "scheduled_start_at", "INTEGER")?;
    ensure_todos_column(conn, "scheduled_end_at", "INTEGER")?;
    ensure_todos_column(conn, "estimated_minutes", "INTEGER")?;
    ensure_table_column(conn, "contacts", "next_follow_up_at", "INTEGER")?;
    ensure_table_column(conn, "contacts", "cadence_days", "INTEGER")?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_todos_status_schedule_due_order
            ON todos (archived_at, completed_at, scheduled_start_at, due_at, sort_order)",
        [],
    )
    .map_err(|err| format!("failed to create todos schedule index: {err}"))?;

    // One-shot backfill so existing notes get into the FTS index after
    // upgrading. The marker in sync_state lets us skip the rebuild on
    // every subsequent open.
    if read_sync_state_int(conn, "notes_fts_backfill_v1")? == 0 {
        conn.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')", [])
            .map_err(|err| format!("failed to backfill notes_fts: {err}"))?;
        write_sync_state_int(conn, "notes_fts_backfill_v1", 1)?;
    }

    Ok(())
}

fn ensure_table_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    let pragma = format!("pragma_table_info('{table_name}')");
    let exists: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {pragma} WHERE name = ?"),
            params![column_name],
            |row| row.get(0),
        )
        .map_err(|err| format!("failed to inspect {table_name} schema: {err}"))?;
    if exists > 0 {
        return Ok(());
    }
    let sql = format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}");
    conn.execute(&sql, [])
        .map_err(|err| format!("failed to add {table_name}.{column_name}: {err}"))?;
    Ok(())
}

fn ensure_todos_column(
    conn: &Connection,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    ensure_table_column(conn, "todos", column_name, column_definition)
}

pub fn read_sync_state_int(conn: &Connection, key: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT value FROM sync_state WHERE key = ?",
        params![key],
        |row| row.get::<_, i64>(0),
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(0),
        other => Err(format!("failed to read sync_state[{key}]: {other}")),
    })
}

pub fn write_sync_state_int(conn: &Connection, key: &str, value: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|err| format!("failed to write sync_state[{key}]: {err}"))?;
    Ok(())
}
