// Write outbox — captures mutating site-admin requests (PUT/POST/DELETE)
// that fail with a network-level error so the next online window can
// replay them, instead of losing work to a brief offline blip. See the
// `write_outbox` schema in local_db.rs for the column contract.
//
// Why this lives next to sync.rs rather than reusing site_admin_http_request:
//   * The outbox needs persistence (rusqlite Connection), and threading
//     a Connection through the existing async command would tangle the
//     `!Send` Connection with the `await`-suspended future.
//   * Replay needs identical headers (bearer token + CF Access tokens)
//     to the original call. We rebuild them here from the stored
//     base_url + auth that the caller passes on `outbox_drain`, so the
//     queue itself doesn't store secrets.

use crate::local_db;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE, COOKIE};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const OUTBOX_HTTP_TIMEOUT_SECS: u64 = 30;
// Drain-time cap. The frontend asks for a single drain pass; we won't
// sit in a loop for minutes if the queue grew large during a long
// offline window. Anything still queued after this cap stays queued
// for the next focus-driven drain.
const OUTBOX_DRAIN_MAX_ENTRIES: u32 = 64;

#[derive(Debug, Deserialize)]
pub struct OutboxEnqueueParams {
    pub base_url: String,
    pub path: String,
    pub method: String,
    pub body: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct OutboxEntry {
    pub id: i64,
    pub base_url: String,
    pub path: String,
    pub method: String,
    pub body_json: String,
    pub enqueued_at: i64,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub last_attempt: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct OutboxStatus {
    pub pending: i64,
    pub failing: i64,
    pub oldest_enqueued_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct OutboxDrainAuth {
    pub bearer_token: Option<String>,
    pub cf_access_client_id: Option<String>,
    pub cf_access_client_secret: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OutboxDrainSummary {
    pub attempted: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub remaining: i64,
}

fn now_unix_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Persist a failed mutating request so a future drain can replay it.
/// The frontend calls this when its own request layer detects a
/// network-level failure (status=0 or invoke error) on a mutating
/// method. Returns the new outbox id so the caller can correlate UI
/// entries with the persisted row.
#[tauri::command]
pub async fn outbox_enqueue(
    app: tauri::AppHandle,
    params: OutboxEnqueueParams,
) -> Result<i64, String> {
    let method_upper = params.method.trim().to_uppercase();
    if method_upper.is_empty() {
        return Err("outbox_enqueue: method is required".to_string());
    }
    let base_url = params.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("outbox_enqueue: base_url is required".to_string());
    }
    let path = params.path.trim();
    if path.is_empty() {
        return Err("outbox_enqueue: path is required".to_string());
    }
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let body_json = match params.body {
        Some(value) => serde_json::to_string(&value)
            .map_err(|err| format!("outbox_enqueue: failed to serialize body: {err}"))?,
        None => String::new(),
    };

    let conn = local_db::open(&app)?;
    conn.execute(
        r#"INSERT INTO write_outbox
             (base_url, path, method, body_json, enqueued_at)
           VALUES (?, ?, ?, ?, ?)"#,
        params![base_url, normalized_path, method_upper, body_json, now_unix_ms()],
    )
    .map_err(|err| format!("outbox_enqueue: insert failed: {err}"))?;

    Ok(conn.last_insert_rowid())
}

/// Returns counts for the SyncStatusPill badge. Cheap (two scalar
/// SELECTs); safe to poll on a 1-2 Hz timer.
#[tauri::command]
pub async fn outbox_status(app: tauri::AppHandle) -> Result<OutboxStatus, String> {
    let conn = local_db::open(&app)?;
    let pending: i64 = conn
        .query_row("SELECT COUNT(*) FROM write_outbox", [], |row| row.get(0))
        .map_err(|err| format!("outbox_status: count failed: {err}"))?;
    let failing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM write_outbox WHERE attempts > 0",
            [],
            |row| row.get(0),
        )
        .map_err(|err| format!("outbox_status: failing count failed: {err}"))?;
    let oldest: Option<i64> = conn
        .query_row(
            "SELECT MIN(enqueued_at) FROM write_outbox",
            [],
            |row| row.get(0),
        )
        .map_err(|err| format!("outbox_status: oldest enqueued_at failed: {err}"))?;
    Ok(OutboxStatus {
        pending,
        failing,
        oldest_enqueued_at: oldest,
    })
}

/// Returns the queue, newest first, so the UI can render a "what's
/// pending" panel. We bound at 200 — the queue should never get this
/// large in normal use, and listing more would just hang the panel.
#[tauri::command]
pub async fn outbox_list(app: tauri::AppHandle) -> Result<Vec<OutboxEntry>, String> {
    let conn = local_db::open(&app)?;
    let mut stmt = conn
        .prepare(
            r#"SELECT id, base_url, path, method, body_json, enqueued_at,
                      attempts, last_error, last_attempt
                 FROM write_outbox
                ORDER BY enqueued_at DESC
                LIMIT 200"#,
        )
        .map_err(|err| format!("outbox_list: prepare failed: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(OutboxEntry {
                id: row.get(0)?,
                base_url: row.get(1)?,
                path: row.get(2)?,
                method: row.get(3)?,
                body_json: row.get(4)?,
                enqueued_at: row.get(5)?,
                attempts: row.get(6)?,
                last_error: row.get(7)?,
                last_attempt: row.get(8)?,
            })
        })
        .map_err(|err| format!("outbox_list: query failed: {err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("outbox_list: collect failed: {err}"))
}

/// Manually delete an outbox entry (e.g. user clicks "Discard" on a
/// failing entry that's no longer wanted).
#[tauri::command]
pub async fn outbox_remove(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    conn.execute("DELETE FROM write_outbox WHERE id = ?", params![id])
        .map_err(|err| format!("outbox_remove: delete failed: {err}"))?;
    Ok(())
}

fn build_drain_headers(auth: &OutboxDrainAuth) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(token) = auth.bearer_token.as_deref() {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            let value = HeaderValue::from_str(&format!("Bearer {trimmed}"))
                .map_err(|_| "outbox_drain: invalid bearer token".to_string())?;
            headers.insert(AUTHORIZATION, value);
        }
    }
    if let Some(cid) = auth.cf_access_client_id.as_deref() {
        let trimmed = cid.trim();
        if !trimmed.is_empty() {
            let name = HeaderName::from_static("cf-access-client-id");
            let value = HeaderValue::from_str(trimmed)
                .map_err(|_| "outbox_drain: invalid cf-access-client-id".to_string())?;
            headers.insert(name, value);
        }
    }
    if let Some(secret) = auth.cf_access_client_secret.as_deref() {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            let name = HeaderName::from_static("cf-access-client-secret");
            let value = HeaderValue::from_str(trimmed)
                .map_err(|_| "outbox_drain: invalid cf-access-client-secret".to_string())?;
            headers.insert(name, value);
        }
    }
    // session_cookie passthrough is not supported on drain — bearer
    // tokens are the canonical desktop auth and the ones the workspace
    // pulls from the keyring at startup.
    let _ = COOKIE; // keep import live for future expansion
    Ok(headers)
}

#[derive(Debug, Deserialize)]
pub struct OutboxDrainParams {
    pub auth: OutboxDrainAuth,
}

/// Replay every queued entry against its original endpoint. On 2xx
/// responses, the row is deleted. On 4xx/5xx responses the row's
/// attempts + last_error are bumped so the UI can show "this one's
/// stuck because of …" rather than re-attempting forever. Network
/// failures (still offline) leave the row untouched but not bumped —
/// that lets a quick reconnect-drain-disconnect cycle not pollute
/// last_error with transient noise.
#[tauri::command]
pub async fn outbox_drain(
    app: tauri::AppHandle,
    params: OutboxDrainParams,
) -> Result<OutboxDrainSummary, String> {
    // Snapshot the queue up front so we don't re-process entries
    // freshly enqueued during the drain window. ORDER BY id ASC keeps
    // FIFO semantics: the oldest queued write goes first so an editor's
    // sequence of saves replays in the order it was made.
    // Bind the Vec into a let so the MappedRows iterator (which
    // borrows `stmt`) is fully consumed before `stmt` falls out of
    // scope. Without the explicit binding, NLL drops things in the
    // wrong order and the borrow checker rejects.
    let pending: Vec<(i64, String, String, String, String)> = {
        let conn = local_db::open(&app)?;
        let mut stmt = conn
            .prepare(
                r#"SELECT id, base_url, path, method, body_json
                     FROM write_outbox
                    ORDER BY id ASC
                    LIMIT ?"#,
            )
            .map_err(|err| format!("outbox_drain: prepare failed: {err}"))?;
        let rows: Result<Vec<_>, _> = stmt
            .query_map(params![OUTBOX_DRAIN_MAX_ENTRIES], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|err| format!("outbox_drain: query failed: {err}"))?
            .collect();
        rows.map_err(|err| format!("outbox_drain: collect failed: {err}"))?
    };

    if pending.is_empty() {
        return Ok(OutboxDrainSummary {
            attempted: 0,
            succeeded: 0,
            failed: 0,
            remaining: 0,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(OUTBOX_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|err| format!("outbox_drain: failed to build http client: {err}"))?;
    let headers = build_drain_headers(&params.auth)?;

    let mut attempted: u32 = 0;
    let mut succeeded: u32 = 0;
    let mut failed: u32 = 0;

    for (id, base_url, path, method, body_json) in pending {
        attempted += 1;
        let url = format!("{base_url}{path}");
        let method_kind = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|err| format!("outbox_drain: invalid method `{method}`: {err}"))?;
        let mut request = client.request(method_kind, &url).headers(headers.clone());
        if !body_json.is_empty() {
            request = request.body(body_json.clone());
        }
        match request.send().await {
            Ok(response) => {
                let status = response.status();
                let raw = response.text().await.unwrap_or_default();
                if status.is_success() {
                    let conn = local_db::open(&app)?;
                    conn.execute("DELETE FROM write_outbox WHERE id = ?", params![id])
                        .map_err(|err| {
                            format!("outbox_drain: failed to delete entry {id}: {err}")
                        })?;
                    succeeded += 1;
                } else {
                    let conn = local_db::open(&app)?;
                    let snippet = raw.chars().take(400).collect::<String>();
                    let last_error = format!("{} {snippet}", status.as_u16());
                    conn.execute(
                        r#"UPDATE write_outbox
                              SET attempts = attempts + 1,
                                  last_error = ?,
                                  last_attempt = ?
                            WHERE id = ?"#,
                        params![last_error, now_unix_ms(), id],
                    )
                    .map_err(|err| format!("outbox_drain: failed to mark entry {id}: {err}"))?;
                    failed += 1;
                }
            }
            Err(err) => {
                // Treat reqwest-level errors (DNS failure, timeout,
                // connection refused) as "still offline" rather than
                // permanently failed. Don't bump attempts; just stop
                // this drain so the next focus-driven drain retries
                // fresh. Otherwise a 6h offline window inflates
                // attempts to 360 and the UI surfaces a misleading
                // "stuck" warning.
                let _ = err;
                break;
            }
        }
    }

    let remaining: i64 = {
        let conn = local_db::open(&app)?;
        conn.query_row("SELECT COUNT(*) FROM write_outbox", [], |row| row.get(0))
            .map_err(|err| format!("outbox_drain: post-count failed: {err}"))?
    };

    Ok(OutboxDrainSummary {
        attempted,
        succeeded,
        failed,
        remaining,
    })
}
