use crate::local_db;
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const PROJECT_ID_PREFIX: &str = "proj_";
const PROJECT_LINK_ID_PREFIX: &str = "plink_";
const DEFAULT_PROJECT_TITLE: &str = "Untitled Project";
const DEFAULT_PROJECT_COLOR: &str = "#f97316";
const DEFAULT_PROJECT_ICON: &str = "i:project";

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectStatus {
    Active,
    Paused,
    Completed,
}

impl ProjectStatus {
    fn as_str(self) -> &'static str {
        match self {
            ProjectStatus::Active => "active",
            ProjectStatus::Paused => "paused",
            ProjectStatus::Completed => "completed",
        }
    }

    fn from_sql(value: String) -> rusqlite::Result<Self> {
        match value.as_str() {
            "active" => Ok(ProjectStatus::Active),
            "paused" => Ok(ProjectStatus::Paused),
            "completed" => Ok(ProjectStatus::Completed),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectLinkTargetType {
    Note,
    Contact,
    CalendarEvent,
    Url,
}

impl ProjectLinkTargetType {
    fn as_str(self) -> &'static str {
        match self {
            ProjectLinkTargetType::Note => "note",
            ProjectLinkTargetType::Contact => "contact",
            ProjectLinkTargetType::CalendarEvent => "calendarEvent",
            ProjectLinkTargetType::Url => "url",
        }
    }

    fn from_sql(value: String) -> rusqlite::Result<Self> {
        match value.as_str() {
            "note" => Ok(ProjectLinkTargetType::Note),
            "contact" => Ok(ProjectLinkTargetType::Contact),
            "calendarEvent" => Ok(ProjectLinkTargetType::CalendarEvent),
            "url" => Ok(ProjectLinkTargetType::Url),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: ProjectStatus,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub due_at: Option<i64>,
    pub pinned_at: Option<i64>,
    pub sort_order: i64,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub open_todo_count: i64,
    pub total_todo_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinkRow {
    pub id: String,
    pub project_id: String,
    pub target_type: ProjectLinkTargetType,
    pub target_id: String,
    pub label: String,
    pub url: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: ProjectRow,
    pub links: Vec<ProjectLinkRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateParams {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<ProjectStatus>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub due_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdateParams {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<ProjectStatus>,
    #[serde(default)]
    pub color: Option<Option<String>>,
    #[serde(default)]
    pub icon: Option<Option<String>>,
    #[serde(default)]
    pub due_at: Option<Option<i64>>,
    pub pinned: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMoveParams {
    pub id: String,
    pub target_id: String,
    pub edge: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinkCreateParams {
    pub project_id: String,
    pub target_type: ProjectLinkTargetType,
    pub target_id: Option<String>,
    pub label: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinksListParams {
    pub project_id: String,
}

fn now_unix_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn new_project_id() -> String {
    format!(
        "{PROJECT_ID_PREFIX}{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    )
}

fn new_project_link_id() -> String {
    format!(
        "{PROJECT_LINK_ID_PREFIX}{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    )
}

fn normalize_id(input: &str, label: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }
    if trimmed.len() > 160 {
        return Err(format!("{label} is too long"));
    }
    Ok(trimmed.to_string())
}

fn normalize_title(input: Option<String>) -> String {
    let value = input.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_PROJECT_TITLE.to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

fn normalize_description(input: Option<String>) -> String {
    input
        .unwrap_or_default()
        .trim()
        .chars()
        .take(5_000)
        .collect()
}

fn normalize_optional_text(input: Option<String>, max_chars: usize) -> Option<String> {
    let trimmed = input?.trim().chars().take(max_chars).collect::<String>();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn project_exists(conn: &Connection, id: &str, active_only: bool) -> Result<bool, String> {
    let sql = if active_only {
        "SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL"
    } else {
        "SELECT COUNT(*) FROM projects WHERE id = ?"
    };
    let count: i64 = conn
        .query_row(sql, params![id], |row| row.get(0))
        .map_err(|err| format!("failed to validate project: {err}"))?;
    Ok(count > 0)
}

fn ensure_project_exists(conn: &Connection, id: &str) -> Result<(), String> {
    if project_exists(conn, id, true)? {
        Ok(())
    } else {
        Err("MISSING_PROJECT: project_id did not match any active project".to_string())
    }
}

fn row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: ProjectStatus::from_sql(row.get::<_, String>(3)?)?,
        color: row.get(4)?,
        icon: row.get(5)?,
        due_at: row.get(6)?,
        pinned_at: row.get(7)?,
        sort_order: row.get(8)?,
        archived_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        open_todo_count: row.get(12)?,
        total_todo_count: row.get(13)?,
    })
}

fn project_select_sql() -> &'static str {
    "SELECT p.id, p.title, p.description, p.status, p.color, p.icon, p.due_at,
            p.pinned_at, p.sort_order, p.archived_at, p.created_at, p.updated_at,
            (SELECT COUNT(*)
               FROM todos t
              WHERE t.project_id = p.id
                AND t.archived_at IS NULL
                AND t.completed_at IS NULL) AS open_todo_count,
            (SELECT COUNT(*)
               FROM todos t
              WHERE t.project_id = p.id
                AND t.archived_at IS NULL) AS total_todo_count
       FROM projects p"
}

fn link_row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectLinkRow> {
    Ok(ProjectLinkRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        target_type: ProjectLinkTargetType::from_sql(row.get::<_, String>(2)?)?,
        target_id: row.get(3)?,
        label: row.get(4)?,
        url: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn get_project(conn: &Connection, id: &str) -> Result<Option<ProjectRow>, String> {
    let id = normalize_id(id, "project id")?;
    let sql = format!("{} WHERE p.id = ?", project_select_sql());
    conn.query_row(&sql, params![id], row_from_sql)
        .optional()
        .map_err(|err| format!("projects_get: {err}"))
}

fn list_projects(conn: &Connection) -> Result<Vec<ProjectRow>, String> {
    let sql = format!(
        "{} ORDER BY p.archived_at IS NOT NULL,
                    p.pinned_at IS NULL,
                    p.pinned_at DESC,
                    p.sort_order,
                    p.updated_at DESC",
        project_select_sql(),
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| format!("projects_list: prepare failed: {err}"))?;
    let rows = stmt
        .query_map([], row_from_sql)
        .map_err(|err| format!("projects_list: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("projects_list: collect failed: {err}"))?;
    Ok(rows)
}

fn max_sort_order(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM projects WHERE archived_at IS NULL",
        [],
        |row| row.get(0),
    )
    .map_err(|err| format!("failed to read max project sort order: {err}"))
}

fn create_project(conn: &Connection, params: ProjectCreateParams) -> Result<ProjectRow, String> {
    let id = new_project_id();
    let now = now_unix_ms();
    let sort_order = max_sort_order(conn)? + 1;
    let status = params.status.unwrap_or(ProjectStatus::Active);
    conn.execute(
        "INSERT INTO projects
            (id, title, description, status, color, icon, due_at, pinned_at,
             sort_order, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)",
        params![
            id,
            normalize_title(params.title),
            normalize_description(params.description),
            status.as_str(),
            normalize_optional_text(params.color, 40)
                .or_else(|| Some(DEFAULT_PROJECT_COLOR.to_string())),
            normalize_optional_text(params.icon, 80)
                .or_else(|| Some(DEFAULT_PROJECT_ICON.to_string())),
            params.due_at,
            sort_order,
            now,
            now,
        ],
    )
    .map_err(|err| format!("projects_create: insert failed: {err}"))?;
    get_project(conn, &id)?
        .ok_or_else(|| "projects_create: created project disappeared".to_string())
}

fn update_project(conn: &Connection, params: ProjectUpdateParams) -> Result<ProjectRow, String> {
    let id = normalize_id(&params.id, "project id")?;
    let existing = get_project(conn, &id)?.ok_or_else(|| "project was not found".to_string())?;
    let title = params.title.map(Some).unwrap_or(Some(existing.title));
    let description = params
        .description
        .map(Some)
        .unwrap_or(Some(existing.description));
    let status = params.status.unwrap_or(existing.status);
    let color = match params.color {
        Some(next) => normalize_optional_text(next, 40),
        None => existing.color,
    };
    let icon = match params.icon {
        Some(next) => normalize_optional_text(next, 80),
        None => existing.icon,
    };
    let due_at = match params.due_at {
        Some(next) => next,
        None => existing.due_at,
    };
    let pinned_at = match params.pinned {
        Some(true) if existing.pinned_at.is_none() => Some(now_unix_ms()),
        Some(true) => existing.pinned_at,
        Some(false) => None,
        None => existing.pinned_at,
    };
    let now = now_unix_ms();
    conn.execute(
        "UPDATE projects
            SET title = ?, description = ?, status = ?, color = ?, icon = ?,
                due_at = ?, pinned_at = ?, updated_at = ?
          WHERE id = ?",
        params![
            normalize_title(title),
            normalize_description(description),
            status.as_str(),
            color,
            icon,
            due_at,
            pinned_at,
            now,
            id,
        ],
    )
    .map_err(|err| format!("projects_update: update failed: {err}"))?;
    get_project(conn, &id)?
        .ok_or_else(|| "projects_update: updated project disappeared".to_string())
}

fn archive_project(conn: &Connection, id: String) -> Result<(), String> {
    let id = normalize_id(&id, "project id")?;
    let now = now_unix_ms();
    conn.execute(
        "UPDATE projects
            SET archived_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![now, now, id],
    )
    .map_err(|err| format!("projects_archive: archive failed: {err}"))?;
    Ok(())
}

fn unarchive_project(conn: &Connection, id: String) -> Result<ProjectRow, String> {
    let id = normalize_id(&id, "project id")?;
    let now = now_unix_ms();
    let sort_order = max_sort_order(conn)? + 1;
    conn.execute(
        "UPDATE projects
            SET archived_at = NULL, sort_order = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NOT NULL",
        params![sort_order, now, id],
    )
    .map_err(|err| format!("projects_unarchive: restore failed: {err}"))?;
    get_project(conn, &id)?.ok_or_else(|| "projects_unarchive: project was not found".to_string())
}

fn move_project(conn: &Connection, params: ProjectMoveParams) -> Result<Vec<ProjectRow>, String> {
    let id = normalize_id(&params.id, "project id")?;
    let target_id = normalize_id(&params.target_id, "target project id")?;
    if id == target_id {
        return list_projects(conn);
    }
    ensure_project_exists(conn, &id)?;
    ensure_project_exists(conn, &target_id)?;

    let mut stmt = conn
        .prepare(
            "SELECT id FROM projects
              WHERE archived_at IS NULL
              ORDER BY sort_order, updated_at DESC",
        )
        .map_err(|err| format!("projects_move: prepare failed: {err}"))?;
    let mut ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("projects_move: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("projects_move: collect failed: {err}"))?;

    ids.retain(|row_id| row_id != &id);
    let Some(target_index) = ids.iter().position(|row_id| row_id == &target_id) else {
        return Err("target project was not found".to_string());
    };
    let insert_at = if params.edge.as_deref() == Some("after") {
        target_index + 1
    } else {
        target_index
    };
    ids.insert(insert_at, id);

    let now = now_unix_ms();
    let tx = conn
        .unchecked_transaction()
        .map_err(|err| format!("projects_move: transaction failed: {err}"))?;
    for (index, project_id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ?",
            params![index as i64, now, project_id],
        )
        .map_err(|err| format!("projects_move: update failed: {err}"))?;
    }
    tx.commit()
        .map_err(|err| format!("projects_move: commit failed: {err}"))?;
    list_projects(conn)
}

fn list_project_links(conn: &Connection, project_id: &str) -> Result<Vec<ProjectLinkRow>, String> {
    let project_id = normalize_id(project_id, "project id")?;
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, target_type, target_id, label, url, created_at
               FROM project_links
              WHERE project_id = ?
              ORDER BY created_at DESC",
        )
        .map_err(|err| format!("project_links_list: prepare failed: {err}"))?;
    let rows = stmt
        .query_map(params![project_id], link_row_from_sql)
        .map_err(|err| format!("project_links_list: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("project_links_list: collect failed: {err}"))?;
    Ok(rows)
}

fn get_project_link(
    conn: &Connection,
    project_id: &str,
    target_type: ProjectLinkTargetType,
    target_id: &str,
) -> Result<ProjectLinkRow, String> {
    conn.query_row(
        "SELECT id, project_id, target_type, target_id, label, url, created_at
           FROM project_links
          WHERE project_id = ? AND target_type = ? AND target_id = ?",
        params![project_id, target_type.as_str(), target_id],
        link_row_from_sql,
    )
    .map_err(|err| format!("project_links_get: {err}"))
}

fn create_project_link(
    conn: &Connection,
    params: ProjectLinkCreateParams,
) -> Result<ProjectLinkRow, String> {
    let project_id = normalize_id(&params.project_id, "project id")?;
    ensure_project_exists(conn, &project_id)?;
    let target_id_source = if params.target_type == ProjectLinkTargetType::Url {
        params.url.clone().or(params.target_id)
    } else {
        params.target_id
    };
    let target_id = normalize_id(
        target_id_source.as_deref().unwrap_or_default(),
        "link target id",
    )?;
    let label = normalize_optional_text(params.label, 220).unwrap_or_else(|| target_id.clone());
    let url = normalize_optional_text(params.url, 2_000);
    let id = new_project_link_id();
    let now = now_unix_ms();
    conn.execute(
        "INSERT INTO project_links
            (id, project_id, target_type, target_id, label, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, target_type, target_id)
         DO UPDATE SET label = excluded.label, url = excluded.url",
        params![
            id,
            project_id,
            params.target_type.as_str(),
            target_id,
            label,
            url,
            now,
        ],
    )
    .map_err(|err| format!("project_links_create: insert failed: {err}"))?;
    get_project_link(conn, &project_id, params.target_type, &target_id)
}

fn delete_project_link(conn: &Connection, id: String) -> Result<(), String> {
    let id = normalize_id(&id, "project link id")?;
    conn.execute("DELETE FROM project_links WHERE id = ?", params![id])
        .map_err(|err| format!("project_links_delete: delete failed: {err}"))?;
    Ok(())
}

#[tauri::command]
pub async fn projects_list(app: tauri::AppHandle) -> Result<Vec<ProjectRow>, String> {
    let conn = local_db::open(&app)?;
    list_projects(&conn)
}

#[tauri::command]
pub async fn projects_get(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<ProjectDetail>, String> {
    let conn = local_db::open(&app)?;
    let Some(project) = get_project(&conn, &id)? else {
        return Ok(None);
    };
    let links = list_project_links(&conn, &project.id)?;
    Ok(Some(ProjectDetail { project, links }))
}

#[tauri::command]
pub async fn projects_create(
    app: tauri::AppHandle,
    params: ProjectCreateParams,
) -> Result<ProjectRow, String> {
    let conn = local_db::open(&app)?;
    create_project(&conn, params)
}

#[tauri::command]
pub async fn projects_update(
    app: tauri::AppHandle,
    params: ProjectUpdateParams,
) -> Result<ProjectRow, String> {
    let conn = local_db::open(&app)?;
    update_project(&conn, params)
}

#[tauri::command]
pub async fn projects_archive(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    archive_project(&conn, id)
}

#[tauri::command]
pub async fn projects_unarchive(app: tauri::AppHandle, id: String) -> Result<ProjectRow, String> {
    let conn = local_db::open(&app)?;
    unarchive_project(&conn, id)
}

#[tauri::command]
pub async fn projects_move(
    app: tauri::AppHandle,
    params: ProjectMoveParams,
) -> Result<Vec<ProjectRow>, String> {
    let conn = local_db::open(&app)?;
    move_project(&conn, params)
}

#[tauri::command]
pub async fn project_links_list(
    app: tauri::AppHandle,
    params: ProjectLinksListParams,
) -> Result<Vec<ProjectLinkRow>, String> {
    let conn = local_db::open(&app)?;
    list_project_links(&conn, &params.project_id)
}

#[tauri::command]
pub async fn project_links_create(
    app: tauri::AppHandle,
    params: ProjectLinkCreateParams,
) -> Result<ProjectLinkRow, String> {
    let conn = local_db::open(&app)?;
    create_project_link(&conn, params)
}

#[tauri::command]
pub async fn project_links_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    delete_project_link(&conn, id)
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

    fn create(conn: &Connection, title: &str) -> ProjectRow {
        create_project(
            conn,
            ProjectCreateParams {
                title: Some(title.to_string()),
                description: None,
                status: None,
                color: None,
                icon: None,
                due_at: None,
            },
        )
        .expect("create project")
    }

    #[test]
    fn project_create_update_archive_and_restore() {
        let conn = test_conn();
        let project = create_project(
            &conn,
            ProjectCreateParams {
                title: Some("  Research  ".to_string()),
                description: Some("  context  ".to_string()),
                status: Some(ProjectStatus::Paused),
                color: Some("#0ea5e9".to_string()),
                icon: Some("i:research".to_string()),
                due_at: Some(1_800_000_000_000),
            },
        )
        .expect("create project");

        assert!(project.id.starts_with(PROJECT_ID_PREFIX));
        assert_eq!(project.title, "Research");
        assert_eq!(project.description, "context");
        assert_eq!(project.status, ProjectStatus::Paused);
        assert_eq!(project.color.as_deref(), Some("#0ea5e9"));
        assert_eq!(project.icon.as_deref(), Some("i:research"));
        assert_eq!(project.due_at, Some(1_800_000_000_000));

        let updated = update_project(
            &conn,
            ProjectUpdateParams {
                id: project.id.clone(),
                title: Some("Launch".to_string()),
                description: Some("Ship v1".to_string()),
                status: Some(ProjectStatus::Active),
                color: Some(None),
                icon: Some(None),
                due_at: Some(None),
                pinned: Some(true),
            },
        )
        .expect("update project");
        assert_eq!(updated.title, "Launch");
        assert_eq!(updated.description, "Ship v1");
        assert_eq!(updated.status, ProjectStatus::Active);
        assert!(updated.color.is_none());
        assert!(updated.icon.is_none());
        assert!(updated.due_at.is_none());
        assert!(updated.pinned_at.is_some());

        archive_project(&conn, updated.id.clone()).expect("archive project");
        let archived = get_project(&conn, &updated.id)
            .expect("read archived")
            .expect("archived project");
        assert!(archived.archived_at.is_some());

        let restored = unarchive_project(&conn, updated.id.clone()).expect("restore project");
        assert!(restored.archived_at.is_none());
    }

    #[test]
    fn project_links_dedupe_and_delete() {
        let conn = test_conn();
        let project = create(&conn, "Launch");
        let first = create_project_link(
            &conn,
            ProjectLinkCreateParams {
                project_id: project.id.clone(),
                target_type: ProjectLinkTargetType::Note,
                target_id: Some("note_1".to_string()),
                label: Some("Spec".to_string()),
                url: None,
            },
        )
        .expect("create link");
        let second = create_project_link(
            &conn,
            ProjectLinkCreateParams {
                project_id: project.id.clone(),
                target_type: ProjectLinkTargetType::Note,
                target_id: Some("note_1".to_string()),
                label: Some("Updated spec".to_string()),
                url: None,
            },
        )
        .expect("dedupe link");
        assert_eq!(first.id, second.id);
        assert_eq!(second.label, "Updated spec");
        assert_eq!(
            list_project_links(&conn, &project.id)
                .expect("list links")
                .len(),
            1
        );

        delete_project_link(&conn, second.id).expect("delete link");
        assert!(list_project_links(&conn, &project.id)
            .expect("list after delete")
            .is_empty());
    }

    #[test]
    fn project_move_reorders_active_projects() {
        let conn = test_conn();
        let a = create(&conn, "A");
        let b = create(&conn, "B");
        let c = create(&conn, "C");

        let rows = move_project(
            &conn,
            ProjectMoveParams {
                id: c.id.clone(),
                target_id: a.id.clone(),
                edge: Some("before".to_string()),
            },
        )
        .expect("move project");
        let ids = rows
            .into_iter()
            .filter(|row| row.archived_at.is_none())
            .map(|row| row.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec![c.id, a.id, b.id]);
    }
}
