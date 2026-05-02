use crate::local_db;
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const TODO_ID_PREFIX: &str = "todo_";
const DEFAULT_TITLE: &str = "Untitled";
const MAX_ESTIMATE_MINUTES: i64 = 24 * 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoRow {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub project_id: Option<String>,
    pub due_at: Option<i64>,
    pub scheduled_start_at: Option<i64>,
    pub scheduled_end_at: Option<i64>,
    pub estimated_minutes: Option<i64>,
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
    pub project_id: Option<String>,
    pub due_at: Option<i64>,
    pub scheduled_start_at: Option<i64>,
    pub scheduled_end_at: Option<i64>,
    pub estimated_minutes: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoUpdateParams {
    pub id: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub project_id: Option<Option<String>>,
    #[serde(default)]
    pub due_at: Option<Option<i64>>,
    #[serde(default)]
    pub scheduled_start_at: Option<Option<i64>>,
    #[serde(default)]
    pub scheduled_end_at: Option<Option<i64>>,
    #[serde(default)]
    pub estimated_minutes: Option<Option<i64>>,
    pub completed: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodosWindowParams {
    pub starts_at: i64,
    pub ends_at: i64,
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

fn normalize_project_id(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 96 {
        return Err("project id is too long".to_string());
    }
    Ok(Some(trimmed.to_string()))
}

fn ensure_project_exists(conn: &Connection, project_id: Option<&str>) -> Result<(), String> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("failed to validate project: {err}"))?;
    if exists == 0 {
        return Err("MISSING_PROJECT: project_id did not match any active project".to_string());
    }
    Ok(())
}

fn normalize_estimated_minutes(value: Option<i64>) -> Option<i64> {
    value
        .filter(|minutes| *minutes > 0)
        .map(|minutes| minutes.min(MAX_ESTIMATE_MINUTES))
}

fn normalize_schedule(
    scheduled_start_at: Option<i64>,
    scheduled_end_at: Option<i64>,
    estimated_minutes: Option<i64>,
) -> (Option<i64>, Option<i64>) {
    let Some(start) = scheduled_start_at else {
        return (None, None);
    };
    let derived_end =
        estimated_minutes.map(|minutes| start.saturating_add(minutes.saturating_mul(60_000)));
    let end = scheduled_end_at
        .filter(|end| *end > start)
        .or_else(|| derived_end.filter(|end| *end > start));
    (Some(start), end)
}

fn row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<TodoRow> {
    Ok(TodoRow {
        id: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        project_id: row.get(3)?,
        due_at: row.get(4)?,
        scheduled_start_at: row.get(5)?,
        scheduled_end_at: row.get(6)?,
        estimated_minutes: row.get(7)?,
        sort_order: row.get(8)?,
        completed_at: row.get(9)?,
        archived_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn get_todo(conn: &Connection, id: &str) -> Result<Option<TodoRow>, String> {
    conn.query_row(
        "SELECT id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at, estimated_minutes,
                sort_order, completed_at, archived_at, created_at, updated_at
           FROM todos
          WHERE id = ? AND archived_at IS NULL",
        params![id],
        row_from_sql,
    )
    .optional()
    .map_err(|err| format!("todos_get: {err}"))
}

fn max_sort_order(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM todos WHERE archived_at IS NULL",
        [],
        |row| row.get(0),
    )
    .map_err(|err| format!("failed to read max todo sort order: {err}"))
}

fn list_todos(conn: &Connection) -> Result<Vec<TodoRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at, estimated_minutes,
                    sort_order, completed_at, archived_at, created_at, updated_at
               FROM todos
              WHERE archived_at IS NULL
              ORDER BY completed_at IS NOT NULL,
                       COALESCE(scheduled_start_at, due_at, 9223372036854775807),
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

fn list_todos_by_project(conn: &Connection, project_id: &str) -> Result<Vec<TodoRow>, String> {
    let project_id = normalize_id(project_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at, estimated_minutes,
                    sort_order, completed_at, archived_at, created_at, updated_at
               FROM todos
              WHERE archived_at IS NULL AND project_id = ?
              ORDER BY completed_at IS NOT NULL,
                       COALESCE(scheduled_start_at, due_at, 9223372036854775807),
                       sort_order,
                       created_at",
        )
        .map_err(|err| format!("todos_list_by_project: prepare failed: {err}"))?;
    let rows = stmt
        .query_map(params![project_id], row_from_sql)
        .map_err(|err| format!("todos_list_by_project: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("todos_list_by_project: collect failed: {err}"))?;
    Ok(rows)
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn list_todos_by_note_source(conn: &Connection, note_id: &str) -> Result<Vec<TodoRow>, String> {
    let note_id = normalize_id(note_id)?;
    let pattern = format!("%workspace://notes/{}%", escape_like(&note_id));
    let mut stmt = conn
        .prepare(
            "SELECT id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at, estimated_minutes,
                    sort_order, completed_at, archived_at, created_at, updated_at
               FROM todos
              WHERE archived_at IS NULL AND notes LIKE ? ESCAPE '\\'
              ORDER BY completed_at IS NOT NULL,
                       COALESCE(scheduled_start_at, due_at, 9223372036854775807),
                       sort_order,
                       created_at",
        )
        .map_err(|err| format!("todos_list_by_note_source: prepare failed: {err}"))?;
    let rows = stmt
        .query_map(params![pattern], row_from_sql)
        .map_err(|err| format!("todos_list_by_note_source: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("todos_list_by_note_source: collect failed: {err}"))?;
    Ok(rows)
}

fn list_todos_window(conn: &Connection, params: TodosWindowParams) -> Result<Vec<TodoRow>, String> {
    if params.ends_at <= params.starts_at {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at, estimated_minutes,
                    sort_order, completed_at, archived_at, created_at, updated_at
               FROM todos
              WHERE archived_at IS NULL
                AND (
                    (
                      scheduled_start_at IS NOT NULL
                      AND scheduled_start_at < ?2
                      AND COALESCE(scheduled_end_at, scheduled_start_at + 1) >= ?1
                    )
                    OR (
                      scheduled_start_at IS NULL
                      AND due_at IS NOT NULL
                      AND due_at >= ?1
                      AND due_at < ?2
                    )
                    OR (
                      scheduled_start_at IS NULL
                      AND due_at IS NULL
                      AND completed_at IS NULL
                    )
                )
              ORDER BY completed_at IS NOT NULL,
                       COALESCE(scheduled_start_at, due_at, 9223372036854775807),
                       sort_order,
                       created_at",
        )
        .map_err(|err| format!("todos_list_window: prepare failed: {err}"))?;
    let rows = stmt
        .query_map(params![params.starts_at, params.ends_at], row_from_sql)
        .map_err(|err| format!("todos_list_window: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("todos_list_window: collect failed: {err}"))?;
    Ok(rows)
}

fn create_todo(conn: &Connection, params: TodoCreateParams) -> Result<TodoRow, String> {
    let id = new_todo_id();
    let now = now_unix_ms();
    let sort_order = max_sort_order(conn)? + 1;
    let project_id = normalize_project_id(params.project_id)?;
    ensure_project_exists(conn, project_id.as_deref())?;
    let estimated_minutes = normalize_estimated_minutes(params.estimated_minutes);
    let (scheduled_start_at, scheduled_end_at) = normalize_schedule(
        params.scheduled_start_at,
        params.scheduled_end_at,
        estimated_minutes,
    );
    conn.execute(
        "INSERT INTO todos
            (id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at, estimated_minutes,
             sort_order, completed_at, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
        params![
            id,
            normalize_title(params.title),
            normalize_notes(params.notes),
            project_id,
            params.due_at,
            scheduled_start_at,
            scheduled_end_at,
            estimated_minutes,
            sort_order,
            now,
            now,
        ],
    )
    .map_err(|err| format!("todos_create: insert failed: {err}"))?;
    get_todo(conn, &id)?.ok_or_else(|| "todos_create: created todo disappeared".to_string())
}

fn update_todo(conn: &Connection, params: TodoUpdateParams) -> Result<TodoRow, String> {
    let id = normalize_id(&params.id)?;
    let existing = get_todo(conn, &id)?.ok_or_else(|| "todo was not found".to_string())?;
    let title = params.title.map(Some).unwrap_or(Some(existing.title));
    let notes = params.notes.map(Some).unwrap_or(Some(existing.notes));
    let project_id = match params.project_id {
        Some(next) => normalize_project_id(next)?,
        None => existing.project_id,
    };
    ensure_project_exists(conn, project_id.as_deref())?;
    let due_at = match params.due_at {
        Some(next) => next,
        None => existing.due_at,
    };
    let estimated_minutes = match params.estimated_minutes {
        Some(next) => normalize_estimated_minutes(next),
        None => existing.estimated_minutes,
    };
    let scheduled_start_at = match params.scheduled_start_at {
        Some(next) => next,
        None => existing.scheduled_start_at,
    };
    let scheduled_end_at = match params.scheduled_end_at {
        Some(next) => next,
        None => existing.scheduled_end_at,
    };
    let (scheduled_start_at, scheduled_end_at) =
        normalize_schedule(scheduled_start_at, scheduled_end_at, estimated_minutes);
    let completed_at = match params.completed {
        Some(true) if existing.completed_at.is_none() => Some(now_unix_ms()),
        Some(false) => None,
        _ => existing.completed_at,
    };
    let now = now_unix_ms();
    conn.execute(
        "UPDATE todos
            SET title = ?, notes = ?, project_id = ?, due_at = ?, scheduled_start_at = ?,
                scheduled_end_at = ?, estimated_minutes = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![
            normalize_title(title),
            normalize_notes(notes),
            project_id,
            due_at,
            scheduled_start_at,
            scheduled_end_at,
            estimated_minutes,
            completed_at,
            now,
            id,
        ],
    )
    .map_err(|err| format!("todos_update: update failed: {err}"))?;
    get_todo(conn, &id)?.ok_or_else(|| "todos_update: updated todo disappeared".to_string())
}

fn archive_todo(conn: &Connection, id: String) -> Result<(), String> {
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

fn clear_completed_todos(conn: &Connection) -> Result<i64, String> {
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

#[tauri::command]
pub async fn todos_list(app: tauri::AppHandle) -> Result<Vec<TodoRow>, String> {
    let conn = local_db::open(&app)?;
    list_todos(&conn)
}

#[tauri::command]
pub async fn todos_list_by_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<TodoRow>, String> {
    let conn = local_db::open(&app)?;
    list_todos_by_project(&conn, &project_id)
}

#[tauri::command]
pub async fn todos_list_by_note_source(
    app: tauri::AppHandle,
    note_id: String,
) -> Result<Vec<TodoRow>, String> {
    let conn = local_db::open(&app)?;
    list_todos_by_note_source(&conn, &note_id)
}

#[tauri::command]
pub async fn todos_list_window(
    app: tauri::AppHandle,
    params: TodosWindowParams,
) -> Result<Vec<TodoRow>, String> {
    let conn = local_db::open(&app)?;
    list_todos_window(&conn, params)
}

#[tauri::command]
pub async fn todos_create(
    app: tauri::AppHandle,
    params: TodoCreateParams,
) -> Result<TodoRow, String> {
    let conn = local_db::open(&app)?;
    create_todo(&conn, params)
}

#[tauri::command]
pub async fn todos_update(
    app: tauri::AppHandle,
    params: TodoUpdateParams,
) -> Result<TodoRow, String> {
    let conn = local_db::open(&app)?;
    update_todo(&conn, params)
}

#[tauri::command]
pub async fn todos_archive(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    archive_todo(&conn, id)
}

#[tauri::command]
pub async fn todos_clear_completed(app: tauri::AppHandle) -> Result<i64, String> {
    let conn = local_db::open(&app)?;
    clear_completed_todos(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory DB");
        conn.pragma_update(None, "foreign_keys", "ON")
            .expect("enable FK pragma");
        local_db::run_migrations(&conn).expect("run local DB migrations");
        conn
    }

    fn create(conn: &Connection, title: &str, due_at: Option<i64>) -> TodoRow {
        create_todo(
            conn,
            TodoCreateParams {
                title: Some(title.to_string()),
                notes: None,
                project_id: None,
                due_at,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
            },
        )
        .expect("create todo")
    }

    #[test]
    fn create_normalizes_inputs_and_appends_sort_order() {
        let conn = test_conn();
        let long_title = "x".repeat(260);
        let long_notes = "n".repeat(10_050);

        let first = create_todo(
            &conn,
            TodoCreateParams {
                title: Some("   ".to_string()),
                notes: Some("  note body  ".to_string()),
                project_id: None,
                due_at: Some(1_700_000_000_000),
                scheduled_start_at: Some(1_700_000_300_000),
                scheduled_end_at: None,
                estimated_minutes: Some(90),
            },
        )
        .expect("create first todo");
        let second = create_todo(
            &conn,
            TodoCreateParams {
                title: Some(long_title),
                notes: Some(long_notes),
                project_id: None,
                due_at: None,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: Some(2_000),
            },
        )
        .expect("create second todo");

        assert!(first.id.starts_with(TODO_ID_PREFIX));
        assert_eq!(first.title, DEFAULT_TITLE);
        assert_eq!(first.notes, "note body");
        assert_eq!(first.due_at, Some(1_700_000_000_000));
        assert_eq!(first.scheduled_start_at, Some(1_700_000_300_000));
        assert_eq!(first.scheduled_end_at, Some(1_700_005_700_000));
        assert_eq!(first.estimated_minutes, Some(90));
        assert_eq!(first.sort_order, 0);
        assert_eq!(second.title.chars().count(), 220);
        assert_eq!(second.notes.chars().count(), 10_000);
        assert_eq!(second.estimated_minutes, Some(MAX_ESTIMATE_MINUTES));
        assert_eq!(second.sort_order, 1);
    }

    #[test]
    fn list_orders_open_by_due_then_done_last_and_hides_archived() {
        let conn = test_conn();
        let no_due = create(&conn, "No due", None);
        let later = create(&conn, "Later", Some(2_000));
        let earlier = create(&conn, "Earlier", Some(1_000));
        let done = create(&conn, "Done", Some(500));
        let archived = create(&conn, "Archived", Some(250));

        update_todo(
            &conn,
            TodoUpdateParams {
                id: done.id.clone(),
                title: None,
                notes: None,
                project_id: None,
                due_at: None,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
                completed: Some(true),
            },
        )
        .expect("complete todo");
        archive_todo(&conn, archived.id.clone()).expect("archive todo");

        let rows = list_todos(&conn).expect("list todos");
        let ids = rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>();
        assert_eq!(ids, vec![earlier.id, later.id, no_due.id, done.id]);
        assert!(rows.last().expect("done row").completed_at.is_some());
        assert!(!ids.contains(&archived.id.as_str()));
    }

    #[test]
    fn update_preserves_fields_and_can_clear_due_and_completion() {
        let conn = test_conn();
        let original = create_todo(
            &conn,
            TodoCreateParams {
                title: Some("  Original  ".to_string()),
                notes: Some("  keep me  ".to_string()),
                project_id: None,
                due_at: Some(4_000),
                scheduled_start_at: Some(10_000),
                scheduled_end_at: Some(70_000),
                estimated_minutes: Some(60),
            },
        )
        .expect("create todo");

        let renamed = update_todo(
            &conn,
            TodoUpdateParams {
                id: original.id.clone(),
                title: Some("Renamed".to_string()),
                notes: None,
                project_id: None,
                due_at: None,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
                completed: None,
            },
        )
        .expect("rename todo");
        assert_eq!(renamed.title, "Renamed");
        assert_eq!(renamed.notes, "keep me");
        assert_eq!(renamed.due_at, Some(4_000));
        assert_eq!(renamed.scheduled_start_at, Some(10_000));
        assert_eq!(renamed.scheduled_end_at, Some(70_000));
        assert_eq!(renamed.estimated_minutes, Some(60));
        assert!(renamed.completed_at.is_none());

        let completed = update_todo(
            &conn,
            TodoUpdateParams {
                id: original.id.clone(),
                title: Some("   ".to_string()),
                notes: Some("  next notes  ".to_string()),
                project_id: None,
                due_at: Some(None),
                scheduled_start_at: Some(None),
                scheduled_end_at: Some(None),
                estimated_minutes: Some(None),
                completed: Some(true),
            },
        )
        .expect("complete todo");
        assert_eq!(completed.title, DEFAULT_TITLE);
        assert_eq!(completed.notes, "next notes");
        assert_eq!(completed.due_at, None);
        assert_eq!(completed.scheduled_start_at, None);
        assert_eq!(completed.scheduled_end_at, None);
        assert_eq!(completed.estimated_minutes, None);
        assert!(completed.completed_at.is_some());

        let reopened = update_todo(
            &conn,
            TodoUpdateParams {
                id: original.id.clone(),
                title: None,
                notes: None,
                project_id: None,
                due_at: None,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
                completed: Some(false),
            },
        )
        .expect("reopen todo");
        assert!(reopened.completed_at.is_none());
        assert!(reopened.updated_at >= original.updated_at);
    }

    #[test]
    fn archive_and_clear_completed_use_soft_delete() {
        let conn = test_conn();
        let open = create(&conn, "Open", None);
        let done_a = create(&conn, "Done A", None);
        let done_b = create(&conn, "Done B", None);

        for id in [&done_a.id, &done_b.id] {
            update_todo(
                &conn,
                TodoUpdateParams {
                    id: id.clone(),
                    title: None,
                    notes: None,
                    project_id: None,
                    due_at: None,
                    scheduled_start_at: None,
                    scheduled_end_at: None,
                    estimated_minutes: None,
                    completed: Some(true),
                },
            )
            .expect("complete todo");
        }

        assert_eq!(clear_completed_todos(&conn).expect("clear completed"), 2);
        let rows = list_todos(&conn).expect("list after clear");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, open.id);

        let archived_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM todos WHERE archived_at IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .expect("count archived todos");
        assert_eq!(archived_count, 2);

        archive_todo(&conn, open.id.clone()).expect("archive open todo");
        assert!(list_todos(&conn).expect("list after archive").is_empty());
        let open_archived_at: Option<i64> = conn
            .query_row(
                "SELECT archived_at FROM todos WHERE id = ?",
                params![open.id],
                |row| row.get(0),
            )
            .expect("read archived_at");
        assert!(open_archived_at.is_some());
    }

    #[test]
    fn project_id_can_be_set_updated_and_cleared() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO projects
                (id, title, description, status, color, icon, due_at, pinned_at,
                 sort_order, archived_at, created_at, updated_at)
             VALUES ('proj_test', 'Launch', '', 'active', NULL, NULL, NULL, NULL, 0, NULL, 1, 1)",
            [],
        )
        .expect("insert project");

        let todo = create_todo(
            &conn,
            TodoCreateParams {
                title: Some("Project task".to_string()),
                notes: None,
                project_id: Some("proj_test".to_string()),
                due_at: None,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
            },
        )
        .expect("create project todo");
        assert_eq!(todo.project_id.as_deref(), Some("proj_test"));

        let cleared = update_todo(
            &conn,
            TodoUpdateParams {
                id: todo.id,
                title: None,
                notes: None,
                project_id: Some(None),
                due_at: None,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
                completed: None,
            },
        )
        .expect("clear project");
        assert!(cleared.project_id.is_none());

        let missing = create_todo(
            &conn,
            TodoCreateParams {
                title: Some("Missing".to_string()),
                notes: None,
                project_id: Some("proj_missing".to_string()),
                due_at: None,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
            },
        );
        assert_eq!(
            missing.unwrap_err(),
            "MISSING_PROJECT: project_id did not match any active project",
        );
    }

    #[test]
    fn targeted_lists_filter_by_project_note_and_window() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO projects
                (id, title, description, status, color, icon, due_at, pinned_at,
                 sort_order, archived_at, created_at, updated_at)
             VALUES ('proj_focus', 'Focus', '', 'active', NULL, NULL, NULL, NULL, 0, NULL, 1, 1)",
            [],
        )
        .expect("insert project");

        let project_todo = create_todo(
            &conn,
            TodoCreateParams {
                title: Some("Project".to_string()),
                notes: None,
                project_id: Some("proj_focus".to_string()),
                due_at: Some(1_000),
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
            },
        )
        .expect("create project todo");
        let note_todo = create_todo(
            &conn,
            TodoCreateParams {
                title: Some("Note".to_string()),
                notes: Some("Source note: [Daily](workspace://notes/note_daily)".to_string()),
                project_id: None,
                due_at: None,
                scheduled_start_at: Some(2_000),
                scheduled_end_at: Some(3_000),
                estimated_minutes: None,
            },
        )
        .expect("create note todo");
        let outside = create_todo(
            &conn,
            TodoCreateParams {
                title: Some("Outside".to_string()),
                notes: None,
                project_id: None,
                due_at: Some(99_000),
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
            },
        )
        .expect("create outside todo");

        assert_eq!(
            list_todos_by_project(&conn, "proj_focus")
                .expect("project todos")
                .iter()
                .map(|row| row.id.clone())
                .collect::<Vec<_>>(),
            vec![project_todo.id.clone()],
        );
        assert_eq!(
            list_todos_by_note_source(&conn, "note_daily")
                .expect("note todos")
                .iter()
                .map(|row| row.id.clone())
                .collect::<Vec<_>>(),
            vec![note_todo.id.clone()],
        );
        let window_ids = list_todos_window(
            &conn,
            TodosWindowParams {
                starts_at: 500,
                ends_at: 4_000,
            },
        )
        .expect("window todos")
        .iter()
        .map(|row| row.id.clone())
        .collect::<Vec<_>>();
        assert_eq!(window_ids, vec![project_todo.id.clone(), note_todo.id]);
        assert!(!window_ids.contains(&outside.id));
    }

    #[test]
    fn mutations_reject_invalid_ids() {
        let conn = test_conn();
        let overlong_id = "x".repeat(97);

        let empty_update = update_todo(
            &conn,
            TodoUpdateParams {
                id: "   ".to_string(),
                title: None,
                notes: None,
                project_id: None,
                due_at: None,
                scheduled_start_at: None,
                scheduled_end_at: None,
                estimated_minutes: None,
                completed: None,
            },
        );
        assert_eq!(empty_update.unwrap_err(), "todo id is required");

        let overlong_archive = archive_todo(&conn, overlong_id);
        assert_eq!(overlong_archive.unwrap_err(), "todo id is too long");
    }
}
