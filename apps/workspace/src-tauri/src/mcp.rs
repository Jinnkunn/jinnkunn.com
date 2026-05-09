use crate::local_db;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::Manager;

const SETTINGS_FILENAME: &str = "mcp-settings.json";
const AUDIT_FILENAME: &str = "mcp-audit.jsonl";
const CONFIRMATIONS_FILENAME: &str = "mcp-confirmations.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMcpSettings {
    pub enabled: bool,
    pub write_mode: WorkspaceMcpWriteMode,
    pub require_confirmation_for_writes: bool,
    pub allow_notes_write: bool,
    pub allow_todos_write: bool,
    pub allow_projects_write: bool,
    pub allow_calendar_write: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WorkspaceMcpWriteMode {
    #[serde(rename = "read-only")]
    ReadOnly,
    #[serde(rename = "local-write")]
    LocalWrite,
}

impl Default for WorkspaceMcpSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            write_mode: WorkspaceMcpWriteMode::LocalWrite,
            require_confirmation_for_writes: true,
            allow_notes_write: true,
            allow_todos_write: true,
            allow_projects_write: true,
            // Calendar changes are externally visible on the calendar surface,
            // so keep them opt-in until the operator explicitly enables them.
            allow_calendar_write: false,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMcpStatus {
    pub ready: bool,
    pub db_path: String,
    pub settings_path: String,
    pub audit_path: String,
    pub confirmations_path: String,
    pub server_command: String,
    pub server_args: Vec<String>,
    pub settings: WorkspaceMcpSettings,
    pub tool_count: usize,
    pub writable_tool_count: usize,
    pub recent_audit_count: usize,
    pub pending_confirmation_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMcpAuditEntry {
    pub at: Option<String>,
    pub tool: Option<String>,
    pub id: Option<String>,
    pub title: Option<String>,
    pub summary: String,
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMcpConfirmation {
    pub id: String,
    pub status: String,
    pub tool: String,
    pub summary: String,
    pub args_hash: Option<String>,
    pub requested_at: Option<String>,
    pub decided_at: Option<String>,
    pub consumed_at: Option<String>,
    pub preview: Value,
    pub args: Value,
}

fn app_data_file(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("failed to create app data dir {}: {err}", dir.display()))?;
    Ok(dir.join(filename))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, SETTINGS_FILENAME)
}

fn audit_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, AUDIT_FILENAME)
}

fn confirmations_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, CONFIRMATIONS_FILENAME)
}

fn read_settings_from_path(path: &PathBuf) -> Result<WorkspaceMcpSettings, String> {
    if !path.exists() {
        return Ok(WorkspaceMcpSettings::default());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read MCP settings {}: {err}", path.display()))?;
    serde_json::from_str::<WorkspaceMcpSettings>(&raw)
        .map_err(|err| format!("failed to parse MCP settings {}: {err}", path.display()))
}

fn write_settings_to_path(path: &PathBuf, settings: &WorkspaceMcpSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "failed to create MCP settings dir {}: {err}",
                parent.display()
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|err| format!("failed to serialize MCP settings: {err}"))?;
    std::fs::write(path, format!("{raw}\n"))
        .map_err(|err| format!("failed to write MCP settings {}: {err}", path.display()))
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn audit_summary(value: &Value) -> String {
    let tool = value_string(value, "tool").unwrap_or_else(|| "workspace.mcp".to_string());
    let title = value_string(value, "title")
        .or_else(|| value_string(value, "id"))
        .or_else(|| value_string(value, "projectId"))
        .or_else(|| value_string(value, "calendarId"));
    match title {
        Some(title) => format!("{tool} · {title}"),
        None => tool,
    }
}

fn read_recent_audit(
    app: &tauri::AppHandle,
    limit: usize,
) -> Result<Vec<WorkspaceMcpAuditEntry>, String> {
    let path = audit_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("failed to read MCP audit {}: {err}", path.display()))?;
    let limit = limit.clamp(1, 80);
    let mut entries = Vec::new();
    for line in raw.lines().rev() {
        if entries.len() >= limit {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        entries.push(WorkspaceMcpAuditEntry {
            at: value_string(&value, "at"),
            tool: value_string(&value, "tool"),
            id: value_string(&value, "id"),
            title: value_string(&value, "title"),
            summary: audit_summary(&value),
            raw: value,
        });
    }
    Ok(entries)
}

fn confirmation_from_value(value: &Value) -> Option<WorkspaceMcpConfirmation> {
    Some(WorkspaceMcpConfirmation {
        id: value_string(value, "id")?,
        status: value_string(value, "status")?,
        tool: value_string(value, "tool")?,
        summary: value_string(value, "summary")
            .unwrap_or_else(|| "Workspace MCP write".to_string()),
        args_hash: value_string(value, "argsHash"),
        requested_at: value_string(value, "requestedAt"),
        decided_at: value_string(value, "decidedAt"),
        consumed_at: value_string(value, "consumedAt"),
        preview: value.get("preview").cloned().unwrap_or(Value::Null),
        args: value.get("args").cloned().unwrap_or(Value::Null),
    })
}

fn read_confirmations_from_path(path: &PathBuf) -> Result<Vec<WorkspaceMcpConfirmation>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read MCP confirmations {}: {err}", path.display()))?;
    let value: Value = serde_json::from_str(&raw).map_err(|err| {
        format!(
            "failed to parse MCP confirmations {}: {err}",
            path.display()
        )
    })?;
    let Some(items) = value.as_array() else {
        return Ok(Vec::new());
    };
    Ok(items.iter().filter_map(confirmation_from_value).collect())
}

fn write_confirmations_to_path(
    path: &PathBuf,
    confirmations: &[WorkspaceMcpConfirmation],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "failed to create MCP confirmations dir {}: {err}",
                parent.display()
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(confirmations)
        .map_err(|err| format!("failed to serialize MCP confirmations: {err}"))?;
    std::fs::write(path, format!("{raw}\n")).map_err(|err| {
        format!(
            "failed to write MCP confirmations {}: {err}",
            path.display()
        )
    })
}

#[tauri::command]
pub fn workspace_mcp_status(app: tauri::AppHandle) -> Result<WorkspaceMcpStatus, String> {
    let db_path = local_db::db_path(&app)?;
    let settings_path = settings_path(&app)?;
    let audit_path = audit_path(&app)?;
    let confirmations_path = confirmations_path(&app)?;
    let settings = read_settings_from_path(&settings_path)?;
    let recent_audit_count = read_recent_audit(&app, 80)?.len();
    let pending_confirmation_count = read_confirmations_from_path(&confirmations_path)?
        .into_iter()
        .filter(|entry| entry.status == "pending")
        .count();
    let writable_tool_count =
        if settings.enabled && settings.write_mode == WorkspaceMcpWriteMode::LocalWrite {
            [
                settings.allow_notes_write,
                settings.allow_todos_write,
                settings.allow_projects_write,
                settings.allow_calendar_write,
            ]
            .into_iter()
            .filter(|enabled| *enabled)
            .count()
        } else {
            0
        };
    Ok(WorkspaceMcpStatus {
        ready: true,
        db_path: db_path.display().to_string(),
        settings_path: settings_path.display().to_string(),
        audit_path: audit_path.display().to_string(),
        confirmations_path: confirmations_path.display().to_string(),
        server_command: "npm".to_string(),
        server_args: vec!["run".to_string(), "workspace:mcp".to_string()],
        settings,
        tool_count: 15,
        writable_tool_count,
        recent_audit_count,
        pending_confirmation_count,
    })
}

#[tauri::command]
pub fn workspace_mcp_settings_get(app: tauri::AppHandle) -> Result<WorkspaceMcpSettings, String> {
    read_settings_from_path(&settings_path(&app)?)
}

#[tauri::command]
pub fn workspace_mcp_settings_update(
    app: tauri::AppHandle,
    settings: WorkspaceMcpSettings,
) -> Result<WorkspaceMcpSettings, String> {
    let path = settings_path(&app)?;
    write_settings_to_path(&path, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_mcp_audit_recent(
    app: tauri::AppHandle,
    limit: Option<usize>,
) -> Result<Vec<WorkspaceMcpAuditEntry>, String> {
    read_recent_audit(&app, limit.unwrap_or(12))
}

#[tauri::command]
pub fn workspace_mcp_confirmations_list(
    app: tauri::AppHandle,
    status: Option<String>,
) -> Result<Vec<WorkspaceMcpConfirmation>, String> {
    let wanted = status.unwrap_or_else(|| "pending".to_string());
    let confirmations = read_confirmations_from_path(&confirmations_path(&app)?)?;
    Ok(confirmations
        .into_iter()
        .filter(|entry| wanted == "all" || entry.status == wanted)
        .collect())
}

#[tauri::command]
pub fn workspace_mcp_confirmation_decide(
    app: tauri::AppHandle,
    id: String,
    decision: String,
) -> Result<WorkspaceMcpConfirmation, String> {
    let next_status = match decision.trim() {
        "approve" | "approved" => "approved",
        "reject" | "rejected" => "rejected",
        _ => return Err("decision must be approve or reject".to_string()),
    };
    let path = confirmations_path(&app)?;
    let mut confirmations = read_confirmations_from_path(&path)?;
    let Some(index) = confirmations.iter().position(|entry| entry.id == id) else {
        return Err("MCP confirmation was not found".to_string());
    };
    if confirmations[index].status != "pending" {
        return Err(format!(
            "MCP confirmation is already {}",
            confirmations[index].status
        ));
    }
    confirmations[index].status = next_status.to_string();
    confirmations[index].decided_at = Some(chrono::Utc::now().to_rfc3339());
    let updated = confirmations[index].clone();
    write_confirmations_to_path(&path, &confirmations)?;
    Ok(updated)
}
