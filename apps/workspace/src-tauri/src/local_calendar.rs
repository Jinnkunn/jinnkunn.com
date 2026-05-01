//! Local-first workspace calendar. Mirrors the `CalendarEvent` /
//! `Calendar` wire shape that the EventKit bridge produces, but the
//! storage lives entirely in workspace.db — no platform calendar
//! account required. The frontend renders these rows alongside the
//! macOS Calendar sources under a synthetic "Workspace" header.
//!
//! Schema lives in `local_db.rs`. The id prefix `lcal_` / `levt_`
//! makes it easy to distinguish a local row from an EventKit UUID
//! when scanning logs or DB dumps.

use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::local_db;

/// Synthetic source id. Stays stable across rebuilds so the frontend's
/// per-calendar visibility prefs (keyed by calendar id) and the source
/// ordering prefs (keyed by source id) keep working across launches.
pub const LOCAL_SOURCE_ID: &str = "workspace-local";
/// Default name for the synthetic source. The frontend hardcodes its
/// own copy for display, but we keep this server-side constant so the
/// id ↔ title pair has a single canonical home.
#[allow(dead_code)]
pub const LOCAL_SOURCE_TITLE: &str = "Workspace";

const CALENDAR_ID_PREFIX: &str = "lcal_";
const EVENT_ID_PREFIX: &str = "levt_";
const DEFAULT_TITLE: &str = "Untitled";
const DEFAULT_COLOR: &str = "#0A84FF";
const MAX_TITLE_CHARS: usize = 220;
const MAX_NOTES_CHARS: usize = 10_000;
const MAX_LOCATION_CHARS: usize = 500;
const MAX_URL_CHARS: usize = 2_048;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCalendarRow {
    /// Stable id, prefixed `lcal_` so the frontend can tell local rows
    /// apart from EventKit UUIDs without a separate type field.
    pub id: String,
    /// Constant `LOCAL_SOURCE_ID` for now. Kept on the wire so future
    /// "multiple workspace sources" (e.g. shared team calendars) drop
    /// in without a frontend type change.
    pub source_id: String,
    pub title: String,
    pub color_hex: String,
    pub allows_modifications: bool,
    pub sort_order: i64,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCalendarEventRow {
    /// Stable id, prefixed `levt_`.
    pub event_identifier: String,
    /// Local events have no external (cross-device) identity yet —
    /// reserved for a future sync-to-cloud feature.
    pub external_identifier: Option<String>,
    pub calendar_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
    /// ISO 8601 with offset, mirroring the EventKit shape so the
    /// frontend can merge both event sources without branching.
    pub starts_at: String,
    pub ends_at: String,
    pub is_all_day: bool,
    pub is_recurring: bool,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCalendarCreateParams {
    pub title: Option<String>,
    pub color_hex: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCalendarUpdateParams {
    pub id: String,
    pub title: Option<String>,
    pub color_hex: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEventFetchRequest {
    /// ISO 8601 (any offset). Inclusive lower bound.
    pub starts_at: String,
    /// ISO 8601 (any offset). Exclusive upper bound.
    pub ends_at: String,
    /// When empty, every (non-archived) calendar is queried — matches
    /// the EventKit bridge's "no filter == all calendars" convention.
    #[serde(default)]
    pub calendar_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEventCreateParams {
    pub calendar_id: String,
    pub title: String,
    /// ISO 8601, must include offset. Convert to unix ms internally.
    pub starts_at: String,
    pub ends_at: String,
    #[serde(default)]
    pub is_all_day: bool,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEventUpdateParams {
    pub id: String,
    pub calendar_id: Option<String>,
    pub title: Option<String>,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub is_all_day: Option<bool>,
    /// Triple-nested option supports clearing the field. `None` =
    /// leave unchanged. `Some(None)` = clear. `Some(Some(value))` =
    /// replace. Same pattern as todos.rs.
    #[serde(default)]
    pub notes: Option<Option<String>>,
    #[serde(default)]
    pub location: Option<Option<String>>,
    #[serde(default)]
    pub url: Option<Option<String>>,
}

fn now_unix_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn new_calendar_id() -> String {
    format!(
        "{CALENDAR_ID_PREFIX}{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    )
}

fn new_event_id() -> String {
    format!(
        "{EVENT_ID_PREFIX}{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    )
}

fn normalize_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("calendar/event id is required".to_string());
    }
    if trimmed.len() > 96 {
        return Err("calendar/event id is too long".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_title(input: Option<String>) -> String {
    let value = input.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_TITLE.to_string()
    } else {
        trimmed.chars().take(MAX_TITLE_CHARS).collect()
    }
}

/// Trim + uppercase a `#RRGGBB` hex color. Falls back to the default
/// blue on anything that isn't recognisable so a typo doesn't poison
/// the row.
fn normalize_color(input: Option<String>) -> String {
    let raw = input.unwrap_or_default();
    let trimmed = raw.trim();
    let bytes = trimmed.as_bytes();
    let valid = match bytes.len() {
        7 if bytes[0] == b'#' => bytes[1..].iter().all(|b| b.is_ascii_hexdigit()),
        _ => false,
    };
    if valid {
        let mut out = String::with_capacity(7);
        out.push('#');
        for ch in trimmed[1..].chars() {
            out.extend(ch.to_uppercase());
        }
        out
    } else {
        DEFAULT_COLOR.to_string()
    }
}

fn normalize_optional_text(input: Option<String>, max_chars: usize) -> Option<String> {
    let value = input.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(max_chars).collect())
    }
}

fn parse_iso_to_ms(input: &str) -> Result<i64, String> {
    DateTime::parse_from_rfc3339(input.trim())
        .map(|dt| dt.with_timezone(&Utc).timestamp_millis())
        .map_err(|err| format!("Invalid ISO 8601 timestamp '{input}': {err}"))
}

fn ms_to_iso(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn calendar_row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalCalendarRow> {
    Ok(LocalCalendarRow {
        id: row.get(0)?,
        source_id: LOCAL_SOURCE_ID.to_string(),
        title: row.get(1)?,
        color_hex: row.get(2)?,
        allows_modifications: true,
        sort_order: row.get(3)?,
        archived_at: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn event_row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalCalendarEventRow> {
    let starts_ms: i64 = row.get(5)?;
    let ends_ms: i64 = row.get(6)?;
    let is_all_day: i64 = row.get(7)?;
    Ok(LocalCalendarEventRow {
        event_identifier: row.get(0)?,
        external_identifier: None,
        calendar_id: row.get(1)?,
        title: row.get(2)?,
        notes: row.get(3)?,
        location: row.get(4)?,
        url: row.get::<_, Option<String>>(8)?,
        starts_at: ms_to_iso(starts_ms),
        ends_at: ms_to_iso(ends_ms),
        is_all_day: is_all_day != 0,
        is_recurring: false,
        archived_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn max_calendar_sort_order(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM local_calendars WHERE archived_at IS NULL",
        [],
        |row| row.get(0),
    )
    .map_err(|err| format!("failed to read max local calendar sort order: {err}"))
}

fn list_calendars(conn: &Connection) -> Result<Vec<LocalCalendarRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, color_hex, sort_order, archived_at, created_at, updated_at
               FROM local_calendars
              WHERE archived_at IS NULL
              ORDER BY sort_order, created_at",
        )
        .map_err(|err| format!("local_calendar list prepare: {err}"))?;
    let rows = stmt
        .query_map([], calendar_row_from_sql)
        .map_err(|err| format!("local_calendar list query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("local_calendar list collect: {err}"))?;
    Ok(rows)
}

fn get_calendar(conn: &Connection, id: &str) -> Result<Option<LocalCalendarRow>, String> {
    conn.query_row(
        "SELECT id, title, color_hex, sort_order, archived_at, created_at, updated_at
           FROM local_calendars
          WHERE id = ? AND archived_at IS NULL",
        params![id],
        calendar_row_from_sql,
    )
    .optional()
    .map_err(|err| format!("local_calendar get: {err}"))
}

fn create_calendar(
    conn: &Connection,
    params: LocalCalendarCreateParams,
) -> Result<LocalCalendarRow, String> {
    let id = new_calendar_id();
    let now = now_unix_ms();
    let sort_order = max_calendar_sort_order(conn)? + 1;
    conn.execute(
        "INSERT INTO local_calendars
            (id, title, color_hex, sort_order, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)",
        params![
            id,
            normalize_title(params.title),
            normalize_color(params.color_hex),
            sort_order,
            now,
            now,
        ],
    )
    .map_err(|err| format!("local_calendar create insert: {err}"))?;
    get_calendar(conn, &id)?
        .ok_or_else(|| "local_calendar create: created row disappeared".to_string())
}

fn update_calendar(
    conn: &Connection,
    params: LocalCalendarUpdateParams,
) -> Result<LocalCalendarRow, String> {
    let id = normalize_id(&params.id)?;
    let existing =
        get_calendar(conn, &id)?.ok_or_else(|| "local_calendar was not found".to_string())?;
    let title = match params.title {
        Some(value) => normalize_title(Some(value)),
        None => existing.title,
    };
    let color_hex = match params.color_hex {
        Some(value) => normalize_color(Some(value)),
        None => existing.color_hex,
    };
    let now = now_unix_ms();
    conn.execute(
        "UPDATE local_calendars
            SET title = ?, color_hex = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![title, color_hex, now, id],
    )
    .map_err(|err| format!("local_calendar update: {err}"))?;
    get_calendar(conn, &id)?
        .ok_or_else(|| "local_calendar update: updated row disappeared".to_string())
}

fn archive_calendar(conn: &Connection, id: String) -> Result<(), String> {
    let id = normalize_id(&id)?;
    let now = now_unix_ms();
    // Archive the calendar itself, and propagate the archive timestamp
    // down to every non-archived event so the events disappear from
    // the agenda alongside their parent. We don't hard-delete because
    // the operator may un-archive later (currently a manual SQL fix,
    // but the data is preserved).
    let tx = conn
        .unchecked_transaction()
        .map_err(|err| format!("local_calendar archive transaction: {err}"))?;
    tx.execute(
        "UPDATE local_calendars
            SET archived_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![now, now, id],
    )
    .map_err(|err| format!("local_calendar archive calendar update: {err}"))?;
    tx.execute(
        "UPDATE local_calendar_events
            SET archived_at = ?, updated_at = ?
          WHERE calendar_id = ? AND archived_at IS NULL",
        params![now, now, id],
    )
    .map_err(|err| format!("local_calendar archive events update: {err}"))?;
    tx.commit()
        .map_err(|err| format!("local_calendar archive commit: {err}"))?;
    Ok(())
}

fn fetch_events(
    conn: &Connection,
    request: &LocalEventFetchRequest,
) -> Result<Vec<LocalCalendarEventRow>, String> {
    let starts_ms = parse_iso_to_ms(&request.starts_at)?;
    let ends_ms = parse_iso_to_ms(&request.ends_at)?;
    if ends_ms <= starts_ms {
        return Err("ends_at must be after starts_at".to_string());
    }

    // Overlap predicate: any event whose start < window.end AND
    // end > window.start. Captures all-day events that span past
    // midnight too. The `archived_at IS NULL` filter sidesteps the
    // need for a separate "live events" view.
    let mut sql = String::from(
        "SELECT id, calendar_id, title, notes, location, starts_at_ms, ends_at_ms,
                is_all_day, url, archived_at, created_at, updated_at
           FROM local_calendar_events
          WHERE archived_at IS NULL
            AND starts_at_ms < ?
            AND ends_at_ms > ?",
    );
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> =
        vec![Box::new(ends_ms), Box::new(starts_ms)];
    if !request.calendar_ids.is_empty() {
        sql.push_str(" AND calendar_id IN (");
        for (idx, id) in request.calendar_ids.iter().enumerate() {
            if idx > 0 {
                sql.push(',');
            }
            sql.push('?');
            params_vec.push(Box::new(id.clone()));
        }
        sql.push(')');
    }
    sql.push_str(" ORDER BY starts_at_ms, created_at");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| format!("local_calendar fetch_events prepare: {err}"))?;
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(params_refs.as_slice(), event_row_from_sql)
        .map_err(|err| format!("local_calendar fetch_events query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("local_calendar fetch_events collect: {err}"))?;
    Ok(rows)
}

fn get_event(conn: &Connection, id: &str) -> Result<Option<LocalCalendarEventRow>, String> {
    conn.query_row(
        "SELECT id, calendar_id, title, notes, location, starts_at_ms, ends_at_ms,
                is_all_day, url, archived_at, created_at, updated_at
           FROM local_calendar_events
          WHERE id = ? AND archived_at IS NULL",
        params![id],
        event_row_from_sql,
    )
    .optional()
    .map_err(|err| format!("local_calendar get_event: {err}"))
}

fn create_event(
    conn: &Connection,
    params: LocalEventCreateParams,
) -> Result<LocalCalendarEventRow, String> {
    let calendar_id = normalize_id(&params.calendar_id)?;
    if get_calendar(conn, &calendar_id)?.is_none() {
        return Err("MISSING_CALENDAR: calendar_id did not match any local calendar".to_string());
    }
    if params.title.trim().is_empty() {
        return Err("INVALID_TITLE: title is required".to_string());
    }
    let starts_ms = parse_iso_to_ms(&params.starts_at)?;
    let ends_ms = parse_iso_to_ms(&params.ends_at)?;
    if ends_ms <= starts_ms {
        return Err("INVALID_RANGE: ends_at must be after starts_at".to_string());
    }
    let id = new_event_id();
    let now = now_unix_ms();
    conn.execute(
        "INSERT INTO local_calendar_events
            (id, calendar_id, title, notes, location, url, starts_at_ms, ends_at_ms,
             is_all_day, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
        params![
            id,
            calendar_id,
            normalize_title(Some(params.title)),
            normalize_optional_text(params.notes, MAX_NOTES_CHARS),
            normalize_optional_text(params.location, MAX_LOCATION_CHARS),
            normalize_optional_text(params.url, MAX_URL_CHARS),
            starts_ms,
            ends_ms,
            if params.is_all_day { 1 } else { 0 },
            now,
            now,
        ],
    )
    .map_err(|err| format!("local_calendar event insert: {err}"))?;
    get_event(conn, &id)?
        .ok_or_else(|| "local_calendar create_event: created row disappeared".to_string())
}

fn update_event(
    conn: &Connection,
    params: LocalEventUpdateParams,
) -> Result<LocalCalendarEventRow, String> {
    let id = normalize_id(&params.id)?;
    let existing =
        get_event(conn, &id)?.ok_or_else(|| "local_calendar event was not found".to_string())?;
    let calendar_id = match params.calendar_id {
        Some(value) => {
            let next = normalize_id(&value)?;
            if next != existing.calendar_id && get_calendar(conn, &next)?.is_none() {
                return Err(
                    "MISSING_CALENDAR: target calendar_id did not match any local calendar"
                        .to_string(),
                );
            }
            next
        }
        None => existing.calendar_id.clone(),
    };
    let title = match params.title {
        Some(value) => normalize_title(Some(value)),
        None => existing.title,
    };
    let starts_ms = match params.starts_at {
        Some(value) => parse_iso_to_ms(&value)?,
        None => parse_iso_to_ms(&existing.starts_at)?,
    };
    let ends_ms = match params.ends_at {
        Some(value) => parse_iso_to_ms(&value)?,
        None => parse_iso_to_ms(&existing.ends_at)?,
    };
    if ends_ms <= starts_ms {
        return Err("INVALID_RANGE: ends_at must be after starts_at".to_string());
    }
    let is_all_day = params.is_all_day.unwrap_or(existing.is_all_day);
    let notes = match params.notes {
        Some(next) => normalize_optional_text(next, MAX_NOTES_CHARS),
        None => existing.notes,
    };
    let location = match params.location {
        Some(next) => normalize_optional_text(next, MAX_LOCATION_CHARS),
        None => existing.location,
    };
    let url = match params.url {
        Some(next) => normalize_optional_text(next, MAX_URL_CHARS),
        None => existing.url,
    };
    let now = now_unix_ms();
    conn.execute(
        "UPDATE local_calendar_events
            SET calendar_id = ?, title = ?, notes = ?, location = ?, url = ?,
                starts_at_ms = ?, ends_at_ms = ?, is_all_day = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![
            calendar_id,
            title,
            notes,
            location,
            url,
            starts_ms,
            ends_ms,
            if is_all_day { 1 } else { 0 },
            now,
            id,
        ],
    )
    .map_err(|err| format!("local_calendar event update: {err}"))?;
    get_event(conn, &id)?
        .ok_or_else(|| "local_calendar update_event: updated row disappeared".to_string())
}

fn archive_event(conn: &Connection, id: String) -> Result<(), String> {
    let id = normalize_id(&id)?;
    let now = now_unix_ms();
    conn.execute(
        "UPDATE local_calendar_events
            SET archived_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![now, now, id],
    )
    .map_err(|err| format!("local_calendar archive_event: {err}"))?;
    Ok(())
}

fn unarchive_event(conn: &Connection, id: String) -> Result<LocalCalendarEventRow, String> {
    let id = normalize_id(&id)?;
    let now = now_unix_ms();
    conn.execute(
        "UPDATE local_calendar_events
            SET archived_at = NULL, updated_at = ?
          WHERE id = ? AND archived_at IS NOT NULL",
        params![now, id],
    )
    .map_err(|err| format!("local_calendar unarchive_event: {err}"))?;
    get_event(conn, &id)?
        .ok_or_else(|| "local_calendar unarchive_event: event was not found".to_string())
}

#[tauri::command]
pub async fn local_calendar_list_calendars(
    app: tauri::AppHandle,
) -> Result<Vec<LocalCalendarRow>, String> {
    let conn = local_db::open(&app)?;
    list_calendars(&conn)
}

#[tauri::command]
pub async fn local_calendar_create_calendar(
    app: tauri::AppHandle,
    params: LocalCalendarCreateParams,
) -> Result<LocalCalendarRow, String> {
    let conn = local_db::open(&app)?;
    create_calendar(&conn, params)
}

#[tauri::command]
pub async fn local_calendar_update_calendar(
    app: tauri::AppHandle,
    params: LocalCalendarUpdateParams,
) -> Result<LocalCalendarRow, String> {
    let conn = local_db::open(&app)?;
    update_calendar(&conn, params)
}

#[tauri::command]
pub async fn local_calendar_archive_calendar(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    archive_calendar(&conn, id)
}

#[tauri::command]
pub async fn local_calendar_fetch_events(
    app: tauri::AppHandle,
    request: LocalEventFetchRequest,
) -> Result<Vec<LocalCalendarEventRow>, String> {
    let conn = local_db::open(&app)?;
    fetch_events(&conn, &request)
}

#[tauri::command]
pub async fn local_calendar_create_event(
    app: tauri::AppHandle,
    params: LocalEventCreateParams,
) -> Result<LocalCalendarEventRow, String> {
    let conn = local_db::open(&app)?;
    create_event(&conn, params)
}

#[tauri::command]
pub async fn local_calendar_update_event(
    app: tauri::AppHandle,
    params: LocalEventUpdateParams,
) -> Result<LocalCalendarEventRow, String> {
    let conn = local_db::open(&app)?;
    update_event(&conn, params)
}

#[tauri::command]
pub async fn local_calendar_archive_event(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    archive_event(&conn, id)
}

#[tauri::command]
pub async fn local_calendar_unarchive_event(
    app: tauri::AppHandle,
    id: String,
) -> Result<LocalCalendarEventRow, String> {
    let conn = local_db::open(&app)?;
    unarchive_event(&conn, id)
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

    fn make_calendar(conn: &Connection, title: &str, color: Option<&str>) -> LocalCalendarRow {
        create_calendar(
            conn,
            LocalCalendarCreateParams {
                title: Some(title.to_string()),
                color_hex: color.map(|s| s.to_string()),
            },
        )
        .expect("create calendar")
    }

    fn make_event(
        conn: &Connection,
        calendar_id: &str,
        title: &str,
        starts_at: &str,
        ends_at: &str,
    ) -> LocalCalendarEventRow {
        create_event(
            conn,
            LocalEventCreateParams {
                calendar_id: calendar_id.to_string(),
                title: title.to_string(),
                starts_at: starts_at.to_string(),
                ends_at: ends_at.to_string(),
                is_all_day: false,
                notes: None,
                location: None,
                url: None,
            },
        )
        .expect("create event")
    }

    #[test]
    fn create_calendar_normalizes_title_and_color_and_appends_sort_order() {
        let conn = test_conn();
        let first = make_calendar(&conn, "   ", None);
        let second = make_calendar(&conn, "  Personal  ", Some("#aabbcc"));
        let third = make_calendar(&conn, "Bad color", Some("not a color"));

        assert!(first.id.starts_with(CALENDAR_ID_PREFIX));
        assert_eq!(first.title, DEFAULT_TITLE);
        assert_eq!(first.color_hex, DEFAULT_COLOR);
        assert_eq!(first.source_id, LOCAL_SOURCE_ID);
        assert_eq!(first.sort_order, 0);
        assert_eq!(second.title, "Personal");
        assert_eq!(second.color_hex, "#AABBCC");
        assert_eq!(second.sort_order, 1);
        assert_eq!(third.color_hex, DEFAULT_COLOR);
        assert_eq!(third.sort_order, 2);
    }

    #[test]
    fn list_calendars_skips_archived_and_orders_by_sort() {
        let conn = test_conn();
        let a = make_calendar(&conn, "A", None);
        let b = make_calendar(&conn, "B", None);
        let _archived = make_calendar(&conn, "Archived", None);
        archive_calendar(&conn, _archived.id.clone()).expect("archive calendar");

        let listed = list_calendars(&conn).expect("list calendars");
        let ids: Vec<_> = listed.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec![a.id.as_str(), b.id.as_str()]);
    }

    #[test]
    fn update_calendar_preserves_unspecified_fields() {
        let conn = test_conn();
        let original = make_calendar(&conn, "Calendar", Some("#112233"));

        let renamed = update_calendar(
            &conn,
            LocalCalendarUpdateParams {
                id: original.id.clone(),
                title: Some("Renamed".to_string()),
                color_hex: None,
            },
        )
        .expect("rename calendar");
        assert_eq!(renamed.title, "Renamed");
        assert_eq!(renamed.color_hex, "#112233");
    }

    #[test]
    fn create_event_validates_input_and_returns_iso_strings() {
        let conn = test_conn();
        let cal = make_calendar(&conn, "Personal", None);

        let bad_title = create_event(
            &conn,
            LocalEventCreateParams {
                calendar_id: cal.id.clone(),
                title: "  ".to_string(),
                starts_at: "2026-04-30T09:00:00-04:00".to_string(),
                ends_at: "2026-04-30T10:00:00-04:00".to_string(),
                is_all_day: false,
                notes: None,
                location: None,
                url: None,
            },
        );
        assert!(bad_title.unwrap_err().starts_with("INVALID_TITLE"));

        let bad_range = create_event(
            &conn,
            LocalEventCreateParams {
                calendar_id: cal.id.clone(),
                title: "Test".to_string(),
                starts_at: "2026-04-30T10:00:00-04:00".to_string(),
                ends_at: "2026-04-30T09:00:00-04:00".to_string(),
                is_all_day: false,
                notes: None,
                location: None,
                url: None,
            },
        );
        assert!(bad_range.unwrap_err().starts_with("INVALID_RANGE"));

        let missing_cal = create_event(
            &conn,
            LocalEventCreateParams {
                calendar_id: "lcal_nope".to_string(),
                title: "Test".to_string(),
                starts_at: "2026-04-30T09:00:00-04:00".to_string(),
                ends_at: "2026-04-30T10:00:00-04:00".to_string(),
                is_all_day: false,
                notes: None,
                location: None,
                url: None,
            },
        );
        assert!(missing_cal.unwrap_err().starts_with("MISSING_CALENDAR"));

        let ok = make_event(
            &conn,
            &cal.id,
            "Standup",
            "2026-04-30T09:00:00-04:00",
            "2026-04-30T09:30:00-04:00",
        );
        assert!(ok.event_identifier.starts_with(EVENT_ID_PREFIX));
        assert_eq!(ok.title, "Standup");
        assert_eq!(ok.calendar_id, cal.id);
        // ms_to_iso emits Z-suffixed UTC; the offset is normalized.
        assert!(ok.starts_at.ends_with('Z'));
    }

    #[test]
    fn fetch_events_filters_by_overlap_window_and_calendar_id() {
        let conn = test_conn();
        let work = make_calendar(&conn, "Work", None);
        let life = make_calendar(&conn, "Life", None);

        let monday = make_event(
            &conn,
            &work.id,
            "Monday meeting",
            "2026-04-27T10:00:00Z",
            "2026-04-27T11:00:00Z",
        );
        let _wed_night = make_event(
            &conn,
            &life.id,
            "Wednesday night",
            "2026-04-29T22:00:00Z",
            "2026-04-30T00:30:00Z",
        );
        let _outside = make_event(
            &conn,
            &work.id,
            "Outside",
            "2026-05-10T10:00:00Z",
            "2026-05-10T11:00:00Z",
        );

        let week = fetch_events(
            &conn,
            &LocalEventFetchRequest {
                starts_at: "2026-04-27T00:00:00Z".to_string(),
                ends_at: "2026-04-30T00:00:00Z".to_string(),
                calendar_ids: vec![],
            },
        )
        .expect("fetch week");
        let titles: Vec<_> = week.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, vec!["Monday meeting", "Wednesday night"]);

        let work_only = fetch_events(
            &conn,
            &LocalEventFetchRequest {
                starts_at: "2026-04-27T00:00:00Z".to_string(),
                ends_at: "2026-05-30T00:00:00Z".to_string(),
                calendar_ids: vec![work.id.clone()],
            },
        )
        .expect("fetch work-only");
        let work_titles: Vec<_> = work_only.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(work_titles, vec!["Monday meeting", "Outside"]);
        assert_eq!(work_only[0].event_identifier, monday.event_identifier);
    }

    #[test]
    fn update_event_supports_partial_patches_and_clearing() {
        let conn = test_conn();
        let cal = make_calendar(&conn, "Personal", None);
        let event = create_event(
            &conn,
            LocalEventCreateParams {
                calendar_id: cal.id.clone(),
                title: "Walk".to_string(),
                starts_at: "2026-04-30T09:00:00Z".to_string(),
                ends_at: "2026-04-30T10:00:00Z".to_string(),
                is_all_day: false,
                notes: Some("Bring water".to_string()),
                location: Some("Park".to_string()),
                url: None,
            },
        )
        .expect("create event");

        let renamed = update_event(
            &conn,
            LocalEventUpdateParams {
                id: event.event_identifier.clone(),
                calendar_id: None,
                title: Some("Run".to_string()),
                starts_at: None,
                ends_at: None,
                is_all_day: None,
                notes: None,
                location: None,
                url: None,
            },
        )
        .expect("rename event");
        assert_eq!(renamed.title, "Run");
        assert_eq!(renamed.notes.as_deref(), Some("Bring water"));
        assert_eq!(renamed.location.as_deref(), Some("Park"));

        let cleared = update_event(
            &conn,
            LocalEventUpdateParams {
                id: event.event_identifier.clone(),
                calendar_id: None,
                title: None,
                starts_at: None,
                ends_at: None,
                is_all_day: None,
                notes: Some(None),
                location: Some(None),
                url: Some(Some("https://example.com".to_string())),
            },
        )
        .expect("clear notes/location");
        assert_eq!(cleared.notes, None);
        assert_eq!(cleared.location, None);
        assert_eq!(cleared.url.as_deref(), Some("https://example.com"));
    }

    #[test]
    fn archive_calendar_cascades_to_events_via_soft_delete() {
        let conn = test_conn();
        let cal = make_calendar(&conn, "Work", None);
        let _event = make_event(
            &conn,
            &cal.id,
            "Standup",
            "2026-04-30T09:00:00Z",
            "2026-04-30T09:30:00Z",
        );
        archive_calendar(&conn, cal.id.clone()).expect("archive calendar");

        assert_eq!(list_calendars(&conn).expect("list calendars").len(), 0);
        let week = fetch_events(
            &conn,
            &LocalEventFetchRequest {
                starts_at: "2026-04-27T00:00:00Z".to_string(),
                ends_at: "2026-05-30T00:00:00Z".to_string(),
                calendar_ids: vec![],
            },
        )
        .expect("fetch events");
        assert!(week.is_empty());
    }
}
