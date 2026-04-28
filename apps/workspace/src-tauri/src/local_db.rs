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
fn run_migrations(conn: &Connection) -> Result<(), String> {
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
        "#,
    )
    .map_err(|err| format!("failed to run local DB migrations: {err}"))?;
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
