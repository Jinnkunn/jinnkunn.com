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
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            notes        TEXT NOT NULL DEFAULT '',
            due_at       INTEGER,
            sort_order   INTEGER NOT NULL,
            completed_at INTEGER,
            archived_at  INTEGER,
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_todos_status_due_order
            ON todos (archived_at, completed_at, due_at, sort_order);
        CREATE INDEX IF NOT EXISTS idx_todos_updated_at
            ON todos (updated_at DESC);

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
