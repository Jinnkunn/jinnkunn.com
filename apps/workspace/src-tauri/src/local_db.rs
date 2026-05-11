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

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const DB_FILENAME: &str = "workspace.db";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupInfo {
    db_path: String,
    exists: bool,
    size_bytes: u64,
    modified_at_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupCreateResult {
    path: String,
    size_bytes: u64,
    created_at_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupRestoreResult {
    restored_from: String,
    db_path: String,
    rollback_backup_path: Option<String>,
    restored_at_ms: i64,
    restart_required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupListEntry {
    path: String,
    name: String,
    size_bytes: u64,
    modified_at_ms: Option<i64>,
    automatic: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupAutoResult {
    created: bool,
    skipped_reason: Option<String>,
    backup: Option<WorkspaceBackupCreateResult>,
    deleted: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupPreviewTable {
    name: String,
    current_count: i64,
    backup_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupPreview {
    source_path: String,
    size_bytes: u64,
    modified_at_ms: Option<i64>,
    tables: Vec<WorkspaceBackupPreviewTable>,
}

const AUTO_BACKUP_PREFIX: &str = "workspace-auto-";
const BACKUP_PREVIEW_TABLES: &[&str] = &[
    "content_files",
    "notes",
    "todos",
    "projects",
    "project_links",
    "contacts",
    "contact_interactions",
    "local_calendars",
    "local_calendar_events",
    "calendar_publish_rules",
    "secure_values",
];

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

#[tauri::command]
pub fn workspace_backup_info(app: tauri::AppHandle) -> Result<WorkspaceBackupInfo, String> {
    let path = db_path(&app)?;
    let metadata = fs::metadata(&path).ok();
    Ok(WorkspaceBackupInfo {
        db_path: path.display().to_string(),
        exists: metadata.is_some(),
        size_bytes: metadata.as_ref().map(|value| value.len()).unwrap_or(0),
        modified_at_ms: metadata
            .and_then(|value| value.modified().ok())
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64),
    })
}

#[tauri::command]
pub fn workspace_backup_create(
    app: tauri::AppHandle,
    destination_path: String,
) -> Result<WorkspaceBackupCreateResult, String> {
    let destination = normalized_user_path(destination_path)?;
    create_backup_at(&app, &destination)
}

#[tauri::command]
pub fn workspace_backups_list(
    app: tauri::AppHandle,
) -> Result<Vec<WorkspaceBackupListEntry>, String> {
    let backups_dir = backups_dir(&app)?;
    let mut entries = Vec::new();
    let read_dir = match fs::read_dir(&backups_dir) {
        Ok(value) => value,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
        Err(err) => {
            return Err(format!(
                "failed to read backups directory {}: {err}",
                backups_dir.display()
            ))
        }
    };
    for entry in read_dir {
        let entry = entry.map_err(|err| format!("failed to read backup entry: {err}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.ends_with(".db") {
            continue;
        }
        let metadata = fs::metadata(&path)
            .map_err(|err| format!("failed to inspect backup {}: {err}", path.display()))?;
        entries.push(WorkspaceBackupListEntry {
            automatic: name.starts_with(AUTO_BACKUP_PREFIX),
            modified_at_ms: metadata_modified_ms(&metadata),
            name: name.to_string(),
            path: path.display().to_string(),
            size_bytes: metadata.len(),
        });
    }
    entries.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    Ok(entries)
}

#[tauri::command]
pub fn workspace_backup_auto(
    app: tauri::AppHandle,
    retention_count: Option<usize>,
) -> Result<WorkspaceBackupAutoResult, String> {
    open(&app)?;
    let backups_dir = backups_dir(&app)?;
    fs::create_dir_all(&backups_dir).map_err(|err| {
        format!(
            "failed to create backups directory {}: {err}",
            backups_dir.display()
        )
    })?;
    let today = Utc::now().format("%Y%m%d").to_string();
    let destination = backups_dir.join(format!("{AUTO_BACKUP_PREFIX}{today}.db"));
    let created = if destination.exists() {
        None
    } else {
        Some(create_backup_at(&app, &destination)?)
    };
    let deleted = prune_auto_backups(&app, retention_count.unwrap_or(10).max(1))?;
    Ok(WorkspaceBackupAutoResult {
        created: created.is_some(),
        skipped_reason: if created.is_none() {
            Some("today's automatic backup already exists".to_string())
        } else {
            None
        },
        backup: created,
        deleted,
    })
}

#[tauri::command]
pub fn workspace_backup_preview(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<WorkspaceBackupPreview, String> {
    let source = normalized_user_path(source_path)?;
    if !source.exists() {
        return Err(format!("backup file does not exist: {}", source.display()));
    }
    validate_sqlite_backup(&source)?;
    let current = open(&app)?;
    let backup = Connection::open(&source)
        .map_err(|err| format!("failed to open backup {}: {err}", source.display()))?;
    let metadata = fs::metadata(&source)
        .map_err(|err| format!("failed to inspect backup {}: {err}", source.display()))?;
    let mut tables = Vec::new();
    for table in BACKUP_PREVIEW_TABLES {
        tables.push(WorkspaceBackupPreviewTable {
            name: table.to_string(),
            current_count: count_table_rows(&current, table)?,
            backup_count: count_table_rows(&backup, table)?,
        });
    }
    Ok(WorkspaceBackupPreview {
        source_path: source.display().to_string(),
        size_bytes: metadata.len(),
        modified_at_ms: metadata_modified_ms(&metadata),
        tables,
    })
}

fn create_backup_at(
    app: &tauri::AppHandle,
    destination: &Path,
) -> Result<WorkspaceBackupCreateResult, String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "failed to create backup directory {}: {err}",
                parent.display()
            )
        })?;
    }
    if destination.exists() {
        fs::remove_file(&destination).map_err(|err| {
            format!(
                "failed to replace existing backup {}: {err}",
                destination.display()
            )
        })?;
    }

    let conn = open(app)?;
    conn.execute("VACUUM INTO ?1", params![destination.display().to_string()])
        .map_err(|err| format!("failed to create backup {}: {err}", destination.display()))?;
    drop(conn);

    let metadata = fs::metadata(&destination).map_err(|err| {
        format!(
            "failed to inspect backup {} after creation: {err}",
            destination.display()
        )
    })?;
    Ok(WorkspaceBackupCreateResult {
        path: destination.display().to_string(),
        size_bytes: metadata.len(),
        created_at_ms: Utc::now().timestamp_millis(),
    })
}

#[tauri::command]
pub fn workspace_backup_restore(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<WorkspaceBackupRestoreResult, String> {
    let source = normalized_user_path(source_path)?;
    if !source.exists() {
        return Err(format!("backup file does not exist: {}", source.display()));
    }
    validate_sqlite_backup(&source)?;

    let target = db_path(&app)?;
    let rollback_backup_path = if target.exists() {
        let backups_dir = target
            .parent()
            .ok_or_else(|| format!("failed to resolve parent for {}", target.display()))?
            .join("backups");
        fs::create_dir_all(&backups_dir).map_err(|err| {
            format!(
                "failed to create rollback backup directory {}: {err}",
                backups_dir.display()
            )
        })?;
        let rollback = backups_dir.join(format!(
            "workspace-before-restore-{}.db",
            Utc::now().format("%Y%m%d-%H%M%S")
        ));
        fs::copy(&target, &rollback).map_err(|err| {
            format!(
                "failed to create rollback backup {}: {err}",
                rollback.display()
            )
        })?;
        Some(rollback)
    } else {
        None
    };

    fs::copy(&source, &target).map_err(|err| {
        format!(
            "failed to restore backup {} to {}: {err}",
            source.display(),
            target.display()
        )
    })?;

    let conn = open(&app)?;
    drop(conn);

    Ok(WorkspaceBackupRestoreResult {
        restored_from: source.display().to_string(),
        db_path: target.display().to_string(),
        rollback_backup_path: rollback_backup_path.map(|path| path.display().to_string()),
        restored_at_ms: Utc::now().timestamp_millis(),
        restart_required: true,
    })
}

fn normalized_user_path(value: String) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("path is required".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let db = db_path(app)?;
    Ok(db
        .parent()
        .ok_or_else(|| format!("failed to resolve parent for {}", db.display()))?
        .join("backups"))
}

fn metadata_modified_ms(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as i64)
}

fn prune_auto_backups(app: &tauri::AppHandle, keep: usize) -> Result<Vec<String>, String> {
    let mut entries = workspace_backups_list(app.clone())?
        .into_iter()
        .filter(|entry| entry.automatic)
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    let mut deleted = Vec::new();
    for entry in entries.into_iter().skip(keep) {
        let path = PathBuf::from(&entry.path);
        match fs::remove_file(&path) {
            Ok(()) => deleted.push(entry.path),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                return Err(format!(
                    "failed to prune old backup {}: {err}",
                    path.display()
                ))
            }
        }
    }
    Ok(deleted)
}

fn count_table_rows(conn: &Connection, table: &str) -> Result<i64, String> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            params![table],
            |row| row.get(0),
        )
        .map_err(|err| format!("failed to inspect table {table}: {err}"))?;
    if exists == 0 {
        return Ok(0);
    }
    let sql = format!("SELECT COUNT(*) FROM {table}");
    conn.query_row(&sql, [], |row| row.get(0))
        .map_err(|err| format!("failed to count table {table}: {err}"))
}

fn validate_sqlite_backup(path: &Path) -> Result<(), String> {
    let conn = Connection::open(path)
        .map_err(|err| format!("failed to open backup {}: {err}", path.display()))?;
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|err| format!("failed to verify backup {}: {err}", path.display()))?;
    if result == "ok" {
        Ok(())
    } else {
        Err(format!(
            "backup {} failed SQLite integrity check: {result}",
            path.display()
        ))
    }
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

        -- Development secret backend. Production defaults to the OS
        -- keychain, but debug builds store Site Admin credentials here
        -- so repeated dev/test launches do not trigger macOS Keychain
        -- prompts. Values are intentionally local-only and never synced.
        CREATE TABLE IF NOT EXISTS secure_values (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_secure_values_updated_at
            ON secure_values (updated_at DESC);

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

        -- Local-first Projects surface. Projects are a lightweight
        -- context layer over notes/todos/contacts/calendar references,
        -- not a website portfolio model. They use archive semantics and
        -- keep enough presentation metadata for a fast local UI.
        CREATE TABLE IF NOT EXISTS projects (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'active',
            color       TEXT,
            icon        TEXT,
            due_at      INTEGER,
            pinned_at   INTEGER,
            sort_order  INTEGER NOT NULL,
            archived_at INTEGER,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_projects_status_order
            ON projects (archived_at, status, pinned_at DESC, sort_order);
        CREATE INDEX IF NOT EXISTS idx_projects_due
            ON projects (archived_at, due_at);
        CREATE INDEX IF NOT EXISTS idx_projects_updated_at
            ON projects (updated_at DESC);

        CREATE TABLE IF NOT EXISTS project_links (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            target_type TEXT NOT NULL,
            target_id   TEXT NOT NULL,
            label       TEXT NOT NULL,
            url         TEXT,
            created_at  INTEGER NOT NULL,
            UNIQUE(project_id, target_type, target_id)
        );
        CREATE INDEX IF NOT EXISTS idx_project_links_project
            ON project_links (project_id, created_at DESC);

        -- Local-first Todos module. These rows stay in workspace.db
        -- alongside notes and use archive semantics so clearing a task
        -- does not physically delete it from the local store.
        CREATE TABLE IF NOT EXISTS todos (
            id                 TEXT PRIMARY KEY,
            title              TEXT NOT NULL,
            notes              TEXT NOT NULL DEFAULT '',
            project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
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
    ensure_todos_column(conn, "project_id", "TEXT")?;
    ensure_table_column(conn, "contacts", "next_follow_up_at", "INTEGER")?;
    ensure_table_column(conn, "contacts", "cadence_days", "INTEGER")?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_todos_status_schedule_due_order
            ON todos (archived_at, completed_at, scheduled_start_at, due_at, sort_order)",
        [],
    )
    .map_err(|err| format!("failed to create todos schedule index: {err}"))?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_todos_project_status
            ON todos (project_id, archived_at, completed_at, scheduled_start_at, due_at, sort_order)",
        [],
    )
    .map_err(|err| format!("failed to create todos project index: {err}"))?;

    // One-shot backfill so existing notes get into the FTS index after
    // upgrading. The marker in sync_state lets us skip the rebuild on
    // every subsequent open.
    if read_sync_state_int(conn, "notes_fts_backfill_v1")? == 0 {
        conn.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')", [])
            .map_err(|err| format!("failed to backfill notes_fts: {err}"))?;
        write_sync_state_int(conn, "notes_fts_backfill_v1", 1)?;
    }

    if read_sync_state_int(conn, "notes_icon_tokens_v1")? == 0 {
        conn.execute_batch(
            r#"
            UPDATE notes
               SET icon = CASE
                   WHEN icon = '◇' AND title = 'Inbox' THEN 'i:inbox'
                   WHEN icon = '◇' THEN 'i:meeting'
                   WHEN icon = '◷'
                        AND (
                            title = 'Daily Notes'
                            OR title GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                        )
                       THEN 'i:calendar'
                   WHEN icon = '◷' THEN 'i:review'
                   WHEN icon = '□' THEN 'i:project'
                   WHEN icon = '✦' THEN 'i:research'
                   ELSE icon
               END
             WHERE icon IN ('◇', '◷', '□', '✦');
            "#,
        )
        .map_err(|err| format!("failed to migrate notes icon tokens: {err}"))?;
        write_sync_state_int(conn, "notes_icon_tokens_v1", 1)?;
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
