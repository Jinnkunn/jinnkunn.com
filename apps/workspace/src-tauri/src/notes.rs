use crate::local_db;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::Manager;

const NOTE_ID_PREFIX: &str = "note_";
const DEFAULT_TITLE: &str = "Untitled";
const NOTES_ASSETS_DIR: &str = "notes-assets";
const MAX_ASSET_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRow {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDetail {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub body_mdx: String,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchResult {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub icon: Option<String>,
    pub excerpt: String,
    pub updated_at: i64,
}

// Patch payload returned by mutation commands so the front end can apply a
// local diff instead of re-fetching the whole tree after every drag/rename.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesMutation {
    pub removed: Vec<String>,
    pub updated: Vec<NoteRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCreated {
    pub note: NoteDetail,
    pub mutation: NotesMutation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCreateParams {
    pub parent_id: Option<String>,
    pub title: Option<String>,
    pub after_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpdateParams {
    pub id: String,
    pub title: Option<String>,
    pub body_mdx: Option<String>,
    #[serde(default)]
    pub icon: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMoveParams {
    pub id: String,
    pub parent_id: Option<String>,
    pub target_id: Option<String>,
    pub edge: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchParams {
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAssetParams {
    pub content_type: String,
    pub base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAssetResult {
    pub url: String,
    pub key: String,
    pub size: usize,
    pub content_type: String,
}

fn now_unix_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn ext_for_content_type(content_type: &str) -> Option<&'static str> {
    match content_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

fn content_type_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

// Locked-down filename pattern for the asset directory. Prevents path
// traversal — the URI protocol handler reuses this so a webview can't
// request `note-asset://localhost/../keychain/foo`.
fn is_valid_asset_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > 96 {
        return false;
    }
    let mut saw_dot = false;
    for c in name.chars() {
        if c == '.' {
            if saw_dot {
                return false;
            }
            saw_dot = true;
            continue;
        }
        if !c.is_ascii_alphanumeric() {
            return false;
        }
    }
    saw_dot
}

pub fn assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?
        .join(NOTES_ASSETS_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("failed to create notes-assets dir: {err}"))?;
    Ok(dir)
}

pub fn resolve_asset_path(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    if !is_valid_asset_filename(name) {
        return None;
    }
    let dir = assets_dir(app).ok()?;
    let path = dir.join(name);
    let canon_path = path.canonicalize().ok()?;
    let canon_dir = dir.canonicalize().ok()?;
    if !canon_path.starts_with(canon_dir) {
        return None;
    }
    Some(canon_path)
}

pub fn asset_content_type(path: &std::path::Path) -> &'static str {
    path.extension()
        .and_then(|e| e.to_str())
        .map(content_type_for_ext)
        .unwrap_or("application/octet-stream")
}

fn new_note_id() -> String {
    format!(
        "{NOTE_ID_PREFIX}{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    )
}

fn normalize_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("note id is required".to_string());
    }
    if trimmed.len() > 96 {
        return Err("note id is too long".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_optional_id(id: Option<String>) -> Result<Option<String>, String> {
    match id {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                normalize_id(trimmed).map(Some)
            }
        }
        None => Ok(None),
    }
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

fn normalize_icon(icon: Option<String>) -> Option<String> {
    icon.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.chars().take(16).collect())
        }
    })
}

fn parent_clause_matches() -> &'static str {
    "((?1 IS NULL AND parent_id IS NULL) OR parent_id = ?1)"
}

fn list_in_parent(conn: &Connection, parent_id: Option<&str>) -> Result<Vec<NoteRow>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, parent_id, title, icon, sort_order, archived_at, created_at, updated_at
               FROM notes
              WHERE archived_at IS NULL AND {}",
            parent_clause_matches()
        ))
        .map_err(|err| format!("list_in_parent: prepare failed: {err}"))?;
    let rows = stmt
        .query_map(params![parent_id], |row| {
            Ok(NoteRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                title: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
                archived_at: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|err| format!("list_in_parent: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("list_in_parent: collect failed: {err}"))?;
    Ok(rows)
}

fn note_exists(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM notes WHERE id = ? AND archived_at IS NULL",
        params![id],
        |_| Ok(()),
    )
    .optional()
    .map_err(|err| format!("failed to check note existence: {err}"))
    .map(|row| row.is_some())
}

fn max_sort_order(conn: &Connection, parent_id: Option<&str>) -> Result<i64, String> {
    conn.query_row(
        &format!(
            "SELECT COALESCE(MAX(sort_order), -1) FROM notes
             WHERE archived_at IS NULL AND {}",
            parent_clause_matches()
        ),
        params![parent_id],
        |row| row.get(0),
    )
    .map_err(|err| format!("failed to read note sort order: {err}"))
}

fn sort_order_after(
    conn: &Connection,
    after_id: &str,
) -> Result<Option<(Option<String>, i64)>, String> {
    conn.query_row(
        "SELECT parent_id, sort_order FROM notes WHERE id = ? AND archived_at IS NULL",
        params![after_id],
        |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?)),
    )
    .optional()
    .map_err(|err| format!("failed to read after note: {err}"))
}

fn shift_siblings_from(
    conn: &Connection,
    parent_id: Option<&str>,
    from_sort_order: i64,
) -> Result<(), String> {
    conn.execute(
        &format!(
            "UPDATE notes
                SET sort_order = sort_order + 1
              WHERE archived_at IS NULL
                AND sort_order >= ?2
                AND {}",
            parent_clause_matches()
        ),
        params![parent_id, from_sort_order],
    )
    .map_err(|err| format!("failed to shift note siblings: {err}"))?;
    Ok(())
}

fn compact_sibling_order(conn: &Connection, parent_id: Option<&str>) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id FROM notes
              WHERE archived_at IS NULL AND {}
              ORDER BY sort_order ASC, updated_at DESC, title COLLATE NOCASE ASC, id ASC",
            parent_clause_matches()
        ))
        .map_err(|err| format!("failed to prepare note sibling compaction: {err}"))?;
    let ids = stmt
        .query_map(params![parent_id], |row| row.get::<_, String>(0))
        .map_err(|err| format!("failed to query note siblings: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("failed to collect note siblings: {err}"))?;
    drop(stmt);
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE notes SET sort_order = ? WHERE id = ?",
            params![index as i64, id],
        )
        .map_err(|err| format!("failed to compact note sibling order: {err}"))?;
    }
    Ok(())
}

fn is_descendant(
    conn: &Connection,
    possible_child_id: &str,
    parent_id: &str,
) -> Result<bool, String> {
    let mut current = Some(possible_child_id.to_string());
    while let Some(id) = current {
        if id == parent_id {
            return Ok(true);
        }
        current = conn
            .query_row(
                "SELECT parent_id FROM notes WHERE id = ?",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|err| format!("failed to inspect note ancestry: {err}"))?
            .flatten();
    }
    Ok(false)
}

#[tauri::command]
pub async fn notes_list(app: tauri::AppHandle) -> Result<Vec<NoteRow>, String> {
    let conn = local_db::open(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, title, icon, sort_order, archived_at, created_at, updated_at
               FROM notes
              WHERE archived_at IS NULL
              ORDER BY parent_id IS NOT NULL, parent_id, sort_order, title COLLATE NOCASE",
        )
        .map_err(|err| format!("notes_list: prepare failed: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NoteRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                title: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
                archived_at: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|err| format!("notes_list: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("notes_list: collect failed: {err}"))?;
    Ok(rows)
}

#[tauri::command]
pub async fn notes_get(app: tauri::AppHandle, id: String) -> Result<Option<NoteDetail>, String> {
    let conn = local_db::open(&app)?;
    let id = normalize_id(&id)?;
    conn.query_row(
        "SELECT id, parent_id, title, body_mdx, icon, sort_order, archived_at, created_at, updated_at
           FROM notes
          WHERE id = ? AND archived_at IS NULL",
        params![id],
        |row| {
            Ok(NoteDetail {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                title: row.get(2)?,
                body_mdx: row.get(3)?,
                icon: row.get(4)?,
                sort_order: row.get(5)?,
                archived_at: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|err| format!("notes_get: {err}"))
}

#[tauri::command]
pub async fn notes_create(
    app: tauri::AppHandle,
    params: NoteCreateParams,
) -> Result<NoteCreated, String> {
    let conn = local_db::open(&app)?;
    let parent_id = normalize_optional_id(params.parent_id)?;
    if let Some(parent) = parent_id.as_deref() {
        if !note_exists(&conn, parent)? {
            return Err("parent note was not found".to_string());
        }
    }
    let title = normalize_title(params.title);
    let after = normalize_optional_id(params.after_id)?;
    let mut target_parent = parent_id;
    let mut sort_order = max_sort_order(&conn, target_parent.as_deref())? + 1;
    if let Some(after_id) = after.as_deref() {
        let (after_parent, after_sort) = sort_order_after(&conn, after_id)?
            .ok_or_else(|| "after note was not found".to_string())?;
        target_parent = after_parent;
        sort_order = after_sort + 1;
    }
    shift_siblings_from(&conn, target_parent.as_deref(), sort_order)?;
    let id = new_note_id();
    let now = now_unix_ms();
    conn.execute(
        "INSERT INTO notes
            (id, parent_id, title, body_mdx, icon, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, '', NULL, ?, ?, ?)",
        params![id, target_parent, title, sort_order, now, now],
    )
    .map_err(|err| format!("notes_create: insert failed: {err}"))?;
    let note = conn
        .query_row(
            "SELECT id, parent_id, title, body_mdx, icon, sort_order, archived_at, created_at, updated_at
               FROM notes
              WHERE id = ?",
            params![id],
            |row| {
                Ok(NoteDetail {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    title: row.get(2)?,
                    body_mdx: row.get(3)?,
                    icon: row.get(4)?,
                    sort_order: row.get(5)?,
                    archived_at: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .map_err(|err| format!("notes_create: failed to read created note: {err}"))?;
    let updated = list_in_parent(&conn, target_parent.as_deref())?;
    let _ = app;
    Ok(NoteCreated {
        note,
        mutation: NotesMutation {
            removed: Vec::new(),
            updated,
        },
    })
}

#[tauri::command]
pub async fn notes_update(
    app: tauri::AppHandle,
    params: NoteUpdateParams,
) -> Result<NoteDetail, String> {
    let conn = local_db::open(&app)?;
    let id = normalize_id(&params.id)?;
    let existing = notes_get(app.clone(), id.clone())
        .await?
        .ok_or_else(|| "note was not found".to_string())?;
    let title = params
        .title
        .map(Some)
        .unwrap_or(Some(existing.title))
        .map(|value| normalize_title(Some(value)))
        .unwrap_or_else(|| DEFAULT_TITLE.to_string());
    let body_mdx = params.body_mdx.unwrap_or(existing.body_mdx);
    let icon = match params.icon {
        Some(next) => normalize_icon(next),
        None => existing.icon,
    };
    let now = now_unix_ms();
    conn.execute(
        "UPDATE notes
            SET title = ?, body_mdx = ?, icon = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![title, body_mdx, icon, now, id],
    )
    .map_err(|err| format!("notes_update: update failed: {err}"))?;
    notes_get(app, id)
        .await?
        .ok_or_else(|| "notes_update: updated note disappeared".to_string())
}

#[tauri::command]
pub async fn notes_move(
    app: tauri::AppHandle,
    params: NoteMoveParams,
) -> Result<NotesMutation, String> {
    let conn = local_db::open(&app)?;
    let id = normalize_id(&params.id)?;
    if !note_exists(&conn, &id)? {
        return Err("note was not found".to_string());
    }
    let target_parent = normalize_optional_id(params.parent_id)?;
    if let Some(parent) = target_parent.as_deref() {
        if parent == id {
            return Err("cannot move a note inside itself".to_string());
        }
        if !note_exists(&conn, parent)? {
            return Err("target parent note was not found".to_string());
        }
        if is_descendant(&conn, parent, &id)? {
            return Err("cannot move a note inside one of its descendants".to_string());
        }
    }
    let old_parent: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM notes WHERE id = ?",
            params![id],
            |row| row.get(0),
        )
        .map_err(|err| format!("notes_move: failed to read old parent: {err}"))?;
    let target_id = normalize_optional_id(params.target_id)?;
    let edge = params.edge.unwrap_or_else(|| "after".to_string());
    let mut insert_parent = target_parent;
    let mut insert_sort = max_sort_order(&conn, insert_parent.as_deref())? + 1;
    if let Some(target) = target_id.as_deref() {
        let target_row = conn
            .query_row(
                "SELECT parent_id, sort_order FROM notes WHERE id = ? AND archived_at IS NULL",
                params![target],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|err| format!("notes_move: failed to read target note: {err}"))?
            .ok_or_else(|| "target note was not found".to_string())?;
        insert_parent = target_row.0;
        insert_sort = if edge == "before" {
            target_row.1
        } else {
            target_row.1 + 1
        };
    }
    shift_siblings_from(&conn, insert_parent.as_deref(), insert_sort)?;
    let now = now_unix_ms();
    conn.execute(
        "UPDATE notes
            SET parent_id = ?, sort_order = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![insert_parent, insert_sort, now, id],
    )
    .map_err(|err| format!("notes_move: update failed: {err}"))?;
    compact_sibling_order(&conn, old_parent.as_deref())?;
    let new_parent: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM notes WHERE id = ?",
            params![id],
            |row| row.get(0),
        )
        .map_err(|err| format!("notes_move: failed to read new parent: {err}"))?;
    if new_parent != old_parent {
        compact_sibling_order(&conn, new_parent.as_deref())?;
    }
    let mut updated = list_in_parent(&conn, old_parent.as_deref())?;
    if new_parent != old_parent {
        updated.extend(list_in_parent(&conn, new_parent.as_deref())?);
    }
    Ok(NotesMutation {
        removed: Vec::new(),
        updated,
    })
}

#[tauri::command]
pub async fn notes_list_archived(app: tauri::AppHandle) -> Result<Vec<NoteRow>, String> {
    let conn = local_db::open(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, title, icon, sort_order, archived_at, created_at, updated_at
               FROM notes
              WHERE archived_at IS NOT NULL
              ORDER BY archived_at DESC",
        )
        .map_err(|err| format!("notes_list_archived: prepare failed: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NoteRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                title: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
                archived_at: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|err| format!("notes_list_archived: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("notes_list_archived: collect failed: {err}"))?;
    Ok(rows)
}

#[tauri::command]
pub async fn notes_unarchive(app: tauri::AppHandle, id: String) -> Result<NotesMutation, String> {
    let conn = local_db::open(&app)?;
    let id = normalize_id(&id)?;
    let exists = conn
        .query_row("SELECT 1 FROM notes WHERE id = ?", params![id], |_| Ok(()))
        .optional()
        .map_err(|err| format!("notes_unarchive: lookup failed: {err}"))?
        .is_some();
    if !exists {
        return Err("note was not found".to_string());
    }
    let now = now_unix_ms();
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE tree(id) AS (
                 SELECT id FROM notes WHERE id = ?
                 UNION ALL
                 SELECT notes.id FROM notes JOIN tree ON notes.parent_id = tree.id
             )
             UPDATE notes
                SET archived_at = NULL, updated_at = ?
              WHERE id IN (SELECT id FROM tree) AND archived_at IS NOT NULL
              RETURNING id, parent_id, title, icon, sort_order, archived_at, created_at, updated_at",
        )
        .map_err(|err| format!("notes_unarchive: prepare failed: {err}"))?;
    let updated = stmt
        .query_map(params![id, now], |row| {
            Ok(NoteRow {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                title: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
                archived_at: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|err| format!("notes_unarchive: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("notes_unarchive: collect failed: {err}"))?;
    Ok(NotesMutation {
        removed: Vec::new(),
        updated,
    })
}

#[tauri::command]
pub async fn notes_archive(app: tauri::AppHandle, id: String) -> Result<NotesMutation, String> {
    let conn = local_db::open(&app)?;
    let id = normalize_id(&id)?;
    if !note_exists(&conn, &id)? {
        return Err("note was not found".to_string());
    }
    let now = now_unix_ms();
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE tree(id) AS (
                 SELECT id FROM notes WHERE id = ?
                 UNION ALL
                 SELECT notes.id FROM notes JOIN tree ON notes.parent_id = tree.id
             )
             UPDATE notes
                SET archived_at = ?, updated_at = ?
              WHERE id IN (SELECT id FROM tree)
              RETURNING id",
        )
        .map_err(|err| format!("notes_archive: prepare failed: {err}"))?;
    let removed: Vec<String> = stmt
        .query_map(params![id, now, now], |row| row.get::<_, String>(0))
        .map_err(|err| format!("notes_archive: archive failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("notes_archive: collect failed: {err}"))?;
    Ok(NotesMutation {
        removed,
        updated: Vec::new(),
    })
}

#[tauri::command]
pub async fn notes_save_asset(
    app: tauri::AppHandle,
    params: NoteAssetParams,
) -> Result<NoteAssetResult, String> {
    let ext = ext_for_content_type(&params.content_type)
        .ok_or_else(|| format!("unsupported content type: {}", params.content_type))?;
    let bytes = STANDARD
        .decode(params.base64.trim())
        .map_err(|err| format!("base64 decode failed: {err}"))?;
    if bytes.is_empty() {
        return Err("asset body is empty".to_string());
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(format!(
            "asset too large ({} bytes, max {} bytes)",
            bytes.len(),
            MAX_ASSET_BYTES
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = hasher.finalize();
    let mut sha = String::with_capacity(32);
    for byte in digest.iter().take(16) {
        use std::fmt::Write as _;
        let _ = write!(&mut sha, "{:02x}", byte);
    }
    let filename = format!("{sha}.{ext}");
    let dir = assets_dir(&app)?;
    let target = dir.join(&filename);
    if !target.exists() {
        std::fs::write(&target, &bytes)
            .map_err(|err| format!("failed to write asset: {err}"))?;
    }
    Ok(NoteAssetResult {
        url: format!("note-asset://localhost/{filename}"),
        key: filename,
        size: bytes.len(),
        content_type: params.content_type.trim().to_ascii_lowercase(),
    })
}

// Wrap each whitespace-separated token in double quotes (escaping any
// embedded quotes per FTS5 rules) and AND them together. Quoting the
// tokens means user input like punctuation or query operators is treated
// as literal text instead of being parsed as an FTS5 expression.
fn build_fts_query(input: &str) -> Option<String> {
    let parts: Vec<String> = input
        .split_whitespace()
        .filter(|tok| !tok.is_empty())
        .map(|tok| {
            let escaped = tok.replace('"', "\"\"");
            format!("\"{escaped}\"")
        })
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

#[tauri::command]
pub async fn notes_search(
    app: tauri::AppHandle,
    params: NoteSearchParams,
) -> Result<Vec<NoteSearchResult>, String> {
    let conn = local_db::open(&app)?;
    let query = params.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let Some(fts_query) = build_fts_query(query) else {
        return Ok(Vec::new());
    };
    // Private-use Unicode delimiters survive JSON transport and won't
    // collide with normal markdown content; the front end splits on them
    // to render <mark> spans without an HTML-injection path.
    let mut stmt = conn
        .prepare(
            "SELECT n.id,
                    n.parent_id,
                    n.title,
                    n.icon,
                    snippet(notes_fts, 1, char(57344), char(57345), '…', 16),
                    n.updated_at
               FROM notes_fts
               JOIN notes n ON n.rowid = notes_fts.rowid
              WHERE notes_fts MATCH ?
                AND n.archived_at IS NULL
              ORDER BY rank
              LIMIT 50",
        )
        .map_err(|err| format!("notes_search: prepare failed: {err}"))?;
    let rows = stmt
        .query_map(params![fts_query], |row| {
            Ok(NoteSearchResult {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                title: row.get(2)?,
                icon: row.get(3)?,
                excerpt: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|err| format!("notes_search: query failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("notes_search: collect failed: {err}"))?;
    Ok(rows)
}
