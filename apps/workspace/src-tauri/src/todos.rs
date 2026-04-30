use crate::local_db;
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

const TODO_ID_PREFIX: &str = "todo_";
const DEFAULT_TITLE: &str = "Untitled";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoRow {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub due_at: Option<i64>,
    pub sort_order: i64,
    pub completed_at: Option<i64>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoCreateParams {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub due_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoUpdateParams {
    pub id: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub due_at: Option<Option<i64>>,
    pub completed: Option<bool>,
}

fn now_unix_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn new_todo_id() -> String {
    format!(
        "{TODO_ID_PREFIX}{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    )
}

fn normalize_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("todo id is required".to_string());
    }
    if trimmed.len() > 96 {
        return Err("todo id is too long".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_title(title: Option<String>) -> String {
    let value = title.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_TITLE.to_string()
    } else {
        trimmed.chars().take(220).collect()
    }
}

fn normalize_notes(notes: Option<String>) -> String {
    notes
        .unwrap_or_default()
        .trim()
        .chars()
        .take(10_000)
        .collect()
}

fn row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<TodoRow> {
    Ok(TodoRow {
        id: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        due_at: row.get(3)?,
        sort_order: row.get(4)?,
        completed_at: row.get(5)?,
        archived_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn get_todo(conn: &rusqlite::Connection, id: &str) -> Result<Option<TodoRow>, String> {
    conn.query_row(
        "SELECT id, title, notes, due_at, sort_order, completed_at, archived_at, created_at, updated_at
           FROM todos
          WHERE id = ? AND archived_at IS NULL",
        params![id],
        row_from_sql,
    )
    .optional()
    .map_err(|err| format!("todos_get: {err}"))
}

fn max_sort_order(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM todos WHERE archived_at IS NULL",
        [],
        |row| row.get(0),
    )
    .map_err(|err| format!("failed to read max todo sort order: {err}"))
}

#[tauri::command]
pub async fn todos_list(app: tauri::AppHandle) -> Result<Vec<TodoRow>, String> {
    let conn = local_db::open(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, notes, due_at, sort_order, completed_at, archived_at, created_at, updated_at
               FROM todos
              WHERE archived_at IS NULL
              ORDER BY completed_at IS NOT NULL,
                       COALESCE(due_at, 9223372036854775807),
                       sort_order,
                       created_at",
        )
        .map_err(|err| format!("todos_list: prepare failed: {err}"))?;
    let rows = stmt
        .query_map([], row_from_sql)
        .map_err(|err| format!("todos_list: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("todos_list: collect failed: {err}"))?;
    Ok(rows)
}

#[tauri::command]
pub async fn todos_create(
    app: tauri::AppHandle,
    params: TodoCreateParams,
) -> Result<TodoRow, String> {
    let conn = local_db::open(&app)?;
    let id = new_todo_id();
    let now = now_unix_ms();
    let sort_order = max_sort_order(&conn)? + 1;
    conn.execute(
        "INSERT INTO todos
            (id, title, notes, due_at, sort_order, completed_at, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
        params![
            id,
            normalize_title(params.title),
            normalize_notes(params.notes),
            params.due_at,
            sort_order,
            now,
            now,
        ],
    )
    .map_err(|err| format!("todos_create: insert failed: {err}"))?;
    get_todo(&conn, &id)?.ok_or_else(|| "todos_create: created todo disappeared".to_string())
}

#[tauri::command]
pub async fn todos_update(
    app: tauri::AppHandle,
    params: TodoUpdateParams,
) -> Result<TodoRow, String> {
    let conn = local_db::open(&app)?;
    let id = normalize_id(&params.id)?;
    let existing = get_todo(&conn, &id)?.ok_or_else(|| "todo was not found".to_string())?;
    let title = params.title.map(Some).unwrap_or(Some(existing.title));
    let notes = params.notes.map(Some).unwrap_or(Some(existing.notes));
    let due_at = match params.due_at {
        Some(next) => next,
        None => existing.due_at,
    };
    let completed_at = match params.completed {
        Some(true) if existing.completed_at.is_none() => Some(now_unix_ms()),
        Some(false) => None,
        _ => existing.completed_at,
    };
    let now = now_unix_ms();
    conn.execute(
        "UPDATE todos
            SET title = ?, notes = ?, due_at = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![
            normalize_title(title),
            normalize_notes(notes),
            due_at,
            completed_at,
            now,
            id,
        ],
    )
    .map_err(|err| format!("todos_update: update failed: {err}"))?;
    get_todo(&conn, &id)?.ok_or_else(|| "todos_update: updated todo disappeared".to_string())
}

#[tauri::command]
pub async fn todos_archive(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    let id = normalize_id(&id)?;
    let now = now_unix_ms();
    conn.execute(
        "UPDATE todos
            SET archived_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![now, now, id],
    )
    .map_err(|err| format!("todos_archive: archive failed: {err}"))?;
    Ok(())
}

#[tauri::command]
pub async fn todos_clear_completed(app: tauri::AppHandle) -> Result<i64, String> {
    let conn = local_db::open(&app)?;
    let now = now_unix_ms();
    let count = conn
        .execute(
            "UPDATE todos
                SET archived_at = ?, updated_at = ?
              WHERE completed_at IS NOT NULL AND archived_at IS NULL",
            params![now, now],
        )
        .map_err(|err| format!("todos_clear_completed: update failed: {err}"))?;
    Ok(count as i64)
}
