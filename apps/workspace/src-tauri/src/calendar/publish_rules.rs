//! Per-event publish overrides for the calendar surface.
//!
//! When the operator marks a calendar event as "publish to public site"
//! (or hides one that would otherwise auto-publish), the override is
//! stored as a JSON blob keyed by `event_key`. The frontend treats this
//! as a content-addressed table — wholesale replace on save — so the
//! backend just exposes load/save and a transactional truncate-then-insert.

use crate::local_db;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarPublishRuleRow {
    event_key: String,
    metadata_json: String,
    updated_at: i64,
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_calendar_rule_key(input: &str) -> Result<String, String> {
    let key = input.trim();
    if key.is_empty() {
        return Err("Missing calendar publish rule event key".to_string());
    }
    if key.len() > 512 {
        return Err("Calendar publish rule event key too long".to_string());
    }
    Ok(key.to_string())
}

#[tauri::command]
pub fn calendar_publish_rules_load(
    app: tauri::AppHandle,
) -> Result<Vec<CalendarPublishRuleRow>, String> {
    let conn = local_db::open(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT event_key, metadata_json, updated_at
             FROM calendar_publish_rules
             ORDER BY event_key ASC",
        )
        .map_err(|err| format!("failed to prepare calendar rules query: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CalendarPublishRuleRow {
                event_key: row.get(0)?,
                metadata_json: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })
        .map_err(|err| format!("failed to query calendar publish rules: {err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("failed to read calendar publish rules: {err}"))
}

#[tauri::command]
pub fn calendar_publish_rules_save(
    app: tauri::AppHandle,
    rows: Vec<CalendarPublishRuleRow>,
) -> Result<(), String> {
    let mut conn = local_db::open(&app)?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("failed to begin calendar rules transaction: {err}"))?;
    tx.execute("DELETE FROM calendar_publish_rules", [])
        .map_err(|err| format!("failed to clear calendar publish rules: {err}"))?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO calendar_publish_rules (event_key, metadata_json, updated_at)
                 VALUES (?, ?, ?)",
            )
            .map_err(|err| format!("failed to prepare calendar rules insert: {err}"))?;
        for row in rows {
            let event_key = normalize_calendar_rule_key(&row.event_key)?;
            let metadata_json = row.metadata_json.trim();
            if metadata_json.is_empty() {
                continue;
            }
            stmt.execute(rusqlite::params![
                event_key,
                metadata_json,
                if row.updated_at > 0 {
                    row.updated_at
                } else {
                    now_unix_ms()
                }
            ])
            .map_err(|err| format!("failed to write calendar publish rule: {err}"))?;
        }
    }
    tx.commit()
        .map_err(|err| format!("failed to commit calendar rules transaction: {err}"))
}
