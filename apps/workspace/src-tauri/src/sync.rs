// Tauri commands that bridge the local SQLite mirror (local_db.rs) to
// the remote D1 via /api/site-admin/sync/pull.
//
// Phase 5a — read-cache only:
//   * `sync_pull`        — fetch rows updated after the local watermark,
//                          INSERT OR REPLACE them, advance the watermark.
//                          Iterates while the server reports `hasMore` so
//                          one call drains the backlog.
//   * `local_get_file`   — read a single row out of the local mirror.
//   * `local_list_files` — list rel_paths under a content/ prefix.
//
// Writes still go through site_admin_http_request -> /api/site-admin/*
// for now; Phase 5b adds an outbox table + push command here.
//
// Concurrency note: rusqlite's `Connection` is `!Send`, and these are
// async Tauri commands. We deliberately do not hold a Connection across
// .await — every await happens on the network side, and the Connection
// is opened, used, and dropped in a single synchronous block before the
// next await. This avoids the "future is not Send" compile error.

use crate::local_db;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const SYNC_KEY_LAST_SINCE: &str = "last_sync_since";
const SYNC_KEY_LAST_AT: &str = "last_sync_at";
const SYNC_DEFAULT_BATCH: u32 = 200;
const SYNC_MAX_ITERATIONS: u32 = 50; // hard cap so one call can't loop forever
const SYNC_HTTP_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Deserialize)]
pub struct SyncPullParams {
    pub base_url: String,
    pub bearer_token: Option<String>,
    pub session_cookie: Option<String>,
    pub cf_access_client_id: Option<String>,
    pub cf_access_client_secret: Option<String>,
    /// Override `?limit=` per pull. Defaults to 200; server clamps to 1000.
    pub batch_limit: Option<u32>,
    /// Force a full-resync (ignore the local watermark). Useful for
    /// recovery if the local mirror is suspected stale; the frontend
    /// can expose this behind a "Resync" button later.
    #[serde(default)]
    pub reset_watermark: bool,
}

#[derive(Debug, Serialize)]
pub struct SyncPullSummary {
    pub rows_applied: u32,
    pub iterations: u32,
    pub last_since: i64,
    pub finished_at_ms: i64,
}

#[derive(Debug, Deserialize)]
struct SyncPullRow {
    #[serde(rename = "relPath")]
    rel_path: String,
    #[serde(rename = "bodyHex")]
    body_hex: String,
    #[serde(rename = "isBinary")]
    is_binary: bool,
    sha: String,
    size: i64,
    #[serde(rename = "updatedAt")]
    updated_at: i64,
    #[serde(rename = "updatedBy")]
    updated_by: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SyncPullPayload {
    rows: Vec<SyncPullRow>,
    #[serde(rename = "nextSince")]
    next_since: i64,
    #[serde(rename = "hasMore")]
    has_more: bool,
}

// Server wraps payloads in `{ ok: true, data: {...} }` (apiOk) — match
// that exactly here so a bad response shape fails fast with a clear
// error instead of silently dropping rows.
#[derive(Debug, Deserialize)]
struct ApiEnvelope<T> {
    ok: bool,
    data: Option<T>,
    error: Option<String>,
    code: Option<String>,
}

fn build_auth_headers(params: &SyncPullParams) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(token) = params.bearer_token.as_deref() {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            let value = HeaderValue::from_str(&format!("Bearer {trimmed}"))
                .map_err(|_| "invalid bearer token header".to_string())?;
            headers.insert(AUTHORIZATION, value);
        }
    }
    if let Some(cookie) = params.session_cookie.as_deref() {
        let trimmed = cookie.trim();
        if !trimmed.is_empty() {
            let value = HeaderValue::from_str(trimmed)
                .map_err(|_| "invalid session cookie header".to_string())?;
            headers.insert(reqwest::header::COOKIE, value);
        }
    }
    if let Some(cid) = params.cf_access_client_id.as_deref() {
        let trimmed = cid.trim();
        if !trimmed.is_empty() {
            let name = HeaderName::from_static("cf-access-client-id");
            let value = HeaderValue::from_str(trimmed)
                .map_err(|_| "invalid cf-access-client-id header".to_string())?;
            headers.insert(name, value);
        }
    }
    if let Some(secret) = params.cf_access_client_secret.as_deref() {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            let name = HeaderName::from_static("cf-access-client-secret");
            let value = HeaderValue::from_str(trimmed)
                .map_err(|_| "invalid cf-access-client-secret header".to_string())?;
            headers.insert(name, value);
        }
    }
    Ok(headers)
}

#[tauri::command]
pub async fn sync_pull(
    app: tauri::AppHandle,
    params: SyncPullParams,
) -> Result<SyncPullSummary, String> {
    let base_url = params.base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("missing base_url".to_string());
    }
    let limit = params.batch_limit.unwrap_or(SYNC_DEFAULT_BATCH).max(1);

    // Open a short-lived connection just to read the watermark; drop it
    // before the first network await so no Connection survives across
    // .await points.
    let mut current_since: i64 = if params.reset_watermark {
        0
    } else {
        let conn = local_db::open(&app)?;
        local_db::read_sync_state_int(&conn, SYNC_KEY_LAST_SINCE)?
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(SYNC_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|err| format!("failed to build http client: {err}"))?;
    let headers = build_auth_headers(&params)?;

    let mut rows_applied: u32 = 0;
    let mut iterations: u32 = 0;
    loop {
        if iterations >= SYNC_MAX_ITERATIONS {
            return Err(format!(
                "sync_pull: aborted after {SYNC_MAX_ITERATIONS} iterations \
                 (server kept returning hasMore=true; check pagination)",
            ));
        }
        iterations += 1;

        let url = format!(
            "{base_url}/api/site-admin/sync/pull?since={current_since}&limit={limit}",
        );
        let response = client
            .get(&url)
            .headers(headers.clone())
            .send()
            .await
            .map_err(|err| format!("sync_pull HTTP request failed: {err}"))?;
        let status = response.status();
        let raw = response
            .text()
            .await
            .map_err(|err| format!("sync_pull: failed to read response body: {err}"))?;
        if !status.is_success() {
            return Err(format!(
                "sync_pull: server returned {} -> {}",
                status.as_u16(),
                raw.chars().take(500).collect::<String>(),
            ));
        }
        let envelope: ApiEnvelope<SyncPullPayload> = serde_json::from_str(&raw).map_err(|err| {
            format!(
                "sync_pull: failed to parse JSON envelope: {err} (body starts: {})",
                raw.chars().take(200).collect::<String>(),
            )
        })?;
        if !envelope.ok {
            return Err(format!(
                "sync_pull: api error {}: {}",
                envelope.code.as_deref().unwrap_or("UNKNOWN"),
                envelope.error.as_deref().unwrap_or(""),
            ));
        }
        let payload = envelope
            .data
            .ok_or_else(|| "sync_pull: api ok but missing `data`".to_string())?;

        let rows_in_batch = payload.rows.len() as u32;
        if rows_in_batch > 0 {
            // All inserts + watermark update in one transaction so a
            // crash mid-batch leaves the local DB at a consistent
            // earlier watermark instead of half-applied rows.
            let conn = local_db::open(&app)?;
            let tx = conn
                .unchecked_transaction()
                .map_err(|err| format!("sync_pull: failed to start tx: {err}"))?;
            for row in payload.rows.iter() {
                let body = hex::decode(&row.body_hex)
                    .map_err(|err| format!("sync_pull: invalid bodyHex for {}: {err}", row.rel_path))?;
                tx.execute(
                    r#"INSERT INTO content_files
                         (rel_path, body, is_binary, sha, size, updated_at, updated_by)
                       VALUES (?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(rel_path) DO UPDATE SET
                         body = excluded.body,
                         is_binary = excluded.is_binary,
                         sha = excluded.sha,
                         size = excluded.size,
                         updated_at = excluded.updated_at,
                         updated_by = excluded.updated_by"#,
                    params![
                        row.rel_path,
                        body,
                        if row.is_binary { 1 } else { 0 },
                        row.sha,
                        row.size,
                        row.updated_at,
                        row.updated_by,
                    ],
                )
                .map_err(|err| format!("sync_pull: failed to upsert {}: {err}", row.rel_path))?;
            }
            local_db::write_sync_state_int(&tx, SYNC_KEY_LAST_SINCE, payload.next_since)?;
            tx.commit()
                .map_err(|err| format!("sync_pull: failed to commit batch: {err}"))?;
            rows_applied += rows_in_batch;
        }

        current_since = payload.next_since;
        if !payload.has_more {
            break;
        }
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let conn = local_db::open(&app)?;
    local_db::write_sync_state_int(&conn, SYNC_KEY_LAST_AT, now_ms)?;

    Ok(SyncPullSummary {
        rows_applied,
        iterations,
        last_since: current_since,
        finished_at_ms: now_ms,
    })
}

#[derive(Debug, Serialize)]
pub struct LocalFileRow {
    pub rel_path: String,
    pub is_binary: bool,
    pub sha: String,
    pub size: i64,
    pub updated_at: i64,
    pub updated_by: Option<String>,
    /// UTF-8-decoded body. `None` when `is_binary == true` so callers
    /// don't accidentally render binary bytes as text — they should
    /// fall back to `body_hex` for those.
    pub body_text: Option<String>,
    /// Lowercase hex of the raw body. Always present so binary files
    /// (images, PDFs, etc.) can still be retrieved client-side.
    pub body_hex: String,
}

#[tauri::command]
pub async fn local_get_file(
    app: tauri::AppHandle,
    rel_path: String,
) -> Result<Option<LocalFileRow>, String> {
    let conn = local_db::open(&app)?;
    let row = conn.query_row(
        r#"SELECT rel_path, body, is_binary, sha, size, updated_at, updated_by
             FROM content_files
            WHERE rel_path = ?"#,
        params![rel_path],
        |row| {
            let bytes: Vec<u8> = row.get(1)?;
            Ok((
                row.get::<_, String>(0)?,
                bytes,
                row.get::<_, i64>(2)? == 1,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        },
    );
    match row {
        Ok((rel_path, bytes, is_binary, sha, size, updated_at, updated_by)) => {
            let body_text = if is_binary {
                None
            } else {
                String::from_utf8(bytes.clone()).ok()
            };
            Ok(Some(LocalFileRow {
                rel_path,
                is_binary,
                sha,
                size,
                updated_at,
                updated_by,
                body_text,
                body_hex: hex::encode(&bytes),
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(format!("local_get_file({rel_path}): {err}")),
    }
}

#[derive(Debug, Serialize)]
pub struct LocalFileEntry {
    pub rel_path: String,
    pub sha: String,
    pub size: i64,
    pub updated_at: i64,
}

/// List rel_paths starting with `prefix`. Mirrors the
/// ContentStore.listFiles non-recursive shape (only direct children of
/// the prefix), so server-side and local-side listings line up.
///
/// `recursive=true` returns every descendant; `false` only returns
/// rows that have no further "/" after the prefix.
#[tauri::command]
pub async fn local_list_files(
    app: tauri::AppHandle,
    prefix: String,
    recursive: bool,
) -> Result<Vec<LocalFileEntry>, String> {
    let conn = local_db::open(&app)?;
    let normalized = prefix.trim_start_matches('/').trim_end_matches('/').to_string();
    let like = format!("{normalized}/%");
    let mut stmt = if recursive {
        conn.prepare(
            r#"SELECT rel_path, sha, size, updated_at
                 FROM content_files
                WHERE rel_path LIKE ?
                ORDER BY rel_path"#,
        )
    } else {
        conn.prepare(
            r#"SELECT rel_path, sha, size, updated_at
                 FROM content_files
                WHERE rel_path LIKE ?
                  AND instr(substr(rel_path, ?), '/') = 0
                ORDER BY rel_path"#,
        )
    }
    .map_err(|err| format!("local_list_files: prepare failed: {err}"))?;

    let rows: Result<Vec<LocalFileEntry>, rusqlite::Error> = if recursive {
        stmt.query_map(params![like], |row| {
            Ok(LocalFileEntry {
                rel_path: row.get(0)?,
                sha: row.get(1)?,
                size: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .and_then(|iter| iter.collect())
    } else {
        let offset = (normalized.len() + 2) as i64; // +1 for '/' +1 for SQLite 1-indexed substr
        stmt.query_map(params![like, offset], |row| {
            Ok(LocalFileEntry {
                rel_path: row.get(0)?,
                sha: row.get(1)?,
                size: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .and_then(|iter| iter.collect())
    };
    rows.map_err(|err| format!("local_list_files: {err}"))
}

#[derive(Debug, Serialize)]
pub struct LocalSyncStatus {
    pub last_sync_since: i64,
    pub last_sync_at_ms: i64,
    pub row_count: i64,
}

/// Quick diagnostic for a future "sync status" UI element. Cheap (one
/// COUNT + two key/value reads), so the frontend can call it after
/// every sync_pull or on a refresh.
#[tauri::command]
pub async fn local_sync_status(app: tauri::AppHandle) -> Result<LocalSyncStatus, String> {
    let conn = local_db::open(&app)?;
    let last_sync_since = local_db::read_sync_state_int(&conn, SYNC_KEY_LAST_SINCE)?;
    let last_sync_at_ms = local_db::read_sync_state_int(&conn, SYNC_KEY_LAST_AT)?;
    let row_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM content_files", [], |row| row.get(0))
        .map_err(|err| format!("local_sync_status: count failed: {err}"))?;
    Ok(LocalSyncStatus {
        last_sync_since,
        last_sync_at_ms,
        row_count,
    })
}
