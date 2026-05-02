//! Personal CRM. Local-first contact records + interaction log,
//! living entirely in workspace.db. The frontend renders a contacts
//! surface (list + detail panel) and uses these commands the same
//! way it uses todos / notes / local_calendar — connection per call,
//! archive semantics, prefixed string ids for log readability.
//!
//! Schema lives in `local_db.rs`. Multi-valued contact methods
//! (emails / phones / tags) are stored as JSON arrays so the schema
//! stays flat; the Rust type round-trips the JSON via serde.

use chrono::{Datelike, Local, NaiveDate, Utc};
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::local_db;

const CONTACT_ID_PREFIX: &str = "ctc_";
const INTERACTION_ID_PREFIX: &str = "cint_";
const DEFAULT_DISPLAY_NAME: &str = "(Unnamed)";
const MAX_NAME_CHARS: usize = 220;
const MAX_FREE_TEXT_CHARS: usize = 10_000;
const MAX_TAGS: usize = 24;
const MAX_TAG_CHARS: usize = 48;
const MAX_CONTACT_METHODS: usize = 12;
const MAX_INTERACTION_NOTE_CHARS: usize = 4_000;

/// One labelled contact method (email / phone). The frontend supplies
/// these as small JSON objects; we just round-trip the structure.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContactMethod {
    pub value: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, rename = "isPrimary")]
    pub is_primary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactRow {
    pub id: String,
    pub display_name: String,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub company: Option<String>,
    pub role: Option<String>,
    pub birthday_month: Option<i64>,
    pub birthday_day: Option<i64>,
    pub birthday_year: Option<i64>,
    pub emails: Vec<ContactMethod>,
    pub phones: Vec<ContactMethod>,
    pub tags: Vec<String>,
    pub notes: String,
    pub next_follow_up_at: Option<i64>,
    pub cadence_days: Option<i64>,
    pub pinned_at: Option<i64>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// `occurred_at` of the most recent interaction, or None when the
    /// contact has no logged interactions yet. Computed at read time
    /// — no denormalised cache to keep in sync.
    pub last_interaction_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactInteractionRow {
    pub id: String,
    pub contact_id: String,
    pub occurred_at: i64,
    pub kind: String,
    pub note: String,
    pub source: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactSearchResult {
    pub id: String,
    pub display_name: String,
    pub company: Option<String>,
    pub excerpt: String,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingBirthday {
    pub contact_id: String,
    pub display_name: String,
    pub birthday_month: i64,
    pub birthday_day: i64,
    pub birthday_year: Option<i64>,
    /// Absolute days from "today" (local UTC date) until the next
    /// occurrence — 0 = today, 1 = tomorrow, … up to the configured
    /// horizon (default 30 days).
    pub days_until: i64,
    /// Birthday year subtracted from the next-occurrence year, when
    /// `birthday_year` is known. None when the user only logged a
    /// month/day without a year.
    pub turning_age: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactCreateParams {
    pub display_name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub company: Option<String>,
    pub role: Option<String>,
    pub birthday_month: Option<i64>,
    pub birthday_day: Option<i64>,
    pub birthday_year: Option<i64>,
    #[serde(default)]
    pub emails: Vec<ContactMethod>,
    #[serde(default)]
    pub phones: Vec<ContactMethod>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub next_follow_up_at: Option<i64>,
    pub cadence_days: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactUpdateParams {
    pub id: String,
    pub display_name: Option<String>,
    pub given_name: Option<Option<String>>,
    pub family_name: Option<Option<String>>,
    pub company: Option<Option<String>>,
    pub role: Option<Option<String>>,
    /// Setting both month + day clears the birthday when both are
    /// `None`. The year can be set/cleared independently.
    pub birthday_month: Option<Option<i64>>,
    pub birthday_day: Option<Option<i64>>,
    pub birthday_year: Option<Option<i64>>,
    pub emails: Option<Vec<ContactMethod>>,
    pub phones: Option<Vec<ContactMethod>>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
    pub next_follow_up_at: Option<Option<i64>>,
    pub cadence_days: Option<Option<i64>>,
    pub pinned: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactInteractionCreateParams {
    pub contact_id: String,
    /// Defaults to "now" when None.
    pub occurred_at: Option<i64>,
    pub kind: String,
    pub note: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactInteractionUpdateParams {
    pub id: String,
    pub occurred_at: Option<i64>,
    pub kind: Option<String>,
    pub note: Option<String>,
    pub source: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactSearchParams {
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingBirthdayParams {
    /// Look-ahead horizon in days. Defaults to 30 when None.
    pub days_ahead: Option<i64>,
}

fn now_unix_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn new_contact_id() -> String {
    format!(
        "{CONTACT_ID_PREFIX}{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    )
}

fn new_interaction_id() -> String {
    format!(
        "{INTERACTION_ID_PREFIX}{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 16)
    )
}

fn normalize_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("contact id is required".to_string());
    }
    if trimmed.len() > 96 {
        return Err("contact id is too long".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_name(input: Option<String>, fallback: &str) -> String {
    let value = input.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.chars().take(MAX_NAME_CHARS).collect()
    }
}

fn normalize_optional(input: Option<String>) -> Option<String> {
    let value = input.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(MAX_NAME_CHARS).collect())
    }
}

fn normalize_notes(input: Option<String>) -> String {
    input
        .unwrap_or_default()
        .trim()
        .chars()
        .take(MAX_FREE_TEXT_CHARS)
        .collect()
}

fn normalize_follow_up_at(input: Option<i64>) -> Option<i64> {
    input.filter(|value| *value > 0)
}

fn normalize_cadence_days(input: Option<i64>) -> Option<i64> {
    input.filter(|value| (1..=3650).contains(value))
}

/// Validate the (month, day) tuple. Both must be present and in range
/// or both must be absent — partial dates aren't allowed because the
/// upcoming-birthday query requires a complete (month, day) anchor.
fn validate_birthday_components(month: Option<i64>, day: Option<i64>) -> Result<(), String> {
    match (month, day) {
        (None, None) => Ok(()),
        (Some(_), None) | (None, Some(_)) => {
            Err("Birthday must include both month and day, or neither.".to_string())
        }
        (Some(m), Some(d)) => {
            if !(1..=12).contains(&m) {
                return Err(format!("Invalid birthday month: {m}"));
            }
            if !(1..=31).contains(&d) {
                return Err(format!("Invalid birthday day: {d}"));
            }
            if NaiveDate::from_ymd_opt(2000, m as u32, d as u32).is_none() {
                return Err(format!("Invalid birthday date: {m}/{d}"));
            }
            Ok(())
        }
    }
}

fn normalize_methods(methods: Vec<ContactMethod>) -> Vec<ContactMethod> {
    let mut seen: Vec<ContactMethod> = Vec::with_capacity(methods.len().min(MAX_CONTACT_METHODS));
    for raw in methods.into_iter().take(MAX_CONTACT_METHODS) {
        let value = raw.value.trim();
        if value.is_empty() {
            continue;
        }
        let trimmed_value: String = value.chars().take(MAX_NAME_CHARS).collect();
        if seen
            .iter()
            .any(|m| m.value.eq_ignore_ascii_case(&trimmed_value))
        {
            continue;
        }
        let label = raw
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(MAX_NAME_CHARS).collect::<String>());
        seen.push(ContactMethod {
            value: trimmed_value,
            label,
            is_primary: raw.is_primary,
        });
    }
    seen
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(tags.len().min(MAX_TAGS));
    for raw in tags.into_iter().take(MAX_TAGS) {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let limited: String = trimmed.chars().take(MAX_TAG_CHARS).collect();
        if !out.iter().any(|t| t.eq_ignore_ascii_case(&limited)) {
            out.push(limited);
        }
    }
    out
}

fn methods_from_json(raw: &str) -> Vec<ContactMethod> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn tags_from_json(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn methods_to_json(methods: &[ContactMethod]) -> String {
    serde_json::to_string(methods).unwrap_or_else(|_| "[]".to_string())
}

fn tags_to_json(tags: &[String]) -> String {
    serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string())
}

fn last_interaction_at(conn: &Connection, contact_id: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT MAX(occurred_at) FROM contact_interactions WHERE contact_id = ?",
        params![contact_id],
        |row| row.get::<_, Option<i64>>(0),
    )
    .map_err(|err| format!("contact last_interaction lookup: {err}"))
}

fn row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<ContactRow> {
    let emails_json: String = row.get(9)?;
    let phones_json: String = row.get(10)?;
    let tags_json: String = row.get(11)?;
    Ok(ContactRow {
        id: row.get(0)?,
        display_name: row.get(1)?,
        given_name: row.get(2)?,
        family_name: row.get(3)?,
        company: row.get(4)?,
        role: row.get(5)?,
        birthday_month: row.get(6)?,
        birthday_day: row.get(7)?,
        birthday_year: row.get(8)?,
        emails: methods_from_json(&emails_json),
        phones: methods_from_json(&phones_json),
        tags: tags_from_json(&tags_json),
        notes: row.get(12)?,
        next_follow_up_at: row.get(13)?,
        cadence_days: row.get(14)?,
        pinned_at: row.get(15)?,
        archived_at: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        // Filled in after the row hydrates because the value is
        // computed in a separate query keyed by `id`. The list/get
        // helpers populate it before returning.
        last_interaction_at: None,
    })
}

const CONTACT_COLUMNS: &str = "id, display_name, given_name, family_name, company, role,
    birthday_month, birthday_day, birthday_year,
    emails_json, phones_json, tags_json, notes, next_follow_up_at, cadence_days,
    pinned_at, archived_at, created_at, updated_at";

fn list_contacts(conn: &Connection) -> Result<Vec<ContactRow>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CONTACT_COLUMNS}
               FROM contacts
              WHERE archived_at IS NULL
              ORDER BY pinned_at IS NULL, pinned_at DESC,
                       LOWER(display_name), created_at"
        ))
        .map_err(|err| format!("contacts list prepare: {err}"))?;
    let rows = stmt
        .query_map([], row_from_sql)
        .map_err(|err| format!("contacts list query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("contacts list collect: {err}"))?;
    let mut out = Vec::with_capacity(rows.len());
    for mut row in rows {
        row.last_interaction_at = last_interaction_at(conn, &row.id)?;
        out.push(row);
    }
    Ok(out)
}

fn list_archived_contacts(conn: &Connection) -> Result<Vec<ContactRow>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CONTACT_COLUMNS}
               FROM contacts
              WHERE archived_at IS NOT NULL
              ORDER BY archived_at DESC, LOWER(display_name), created_at"
        ))
        .map_err(|err| format!("contacts archived list prepare: {err}"))?;
    let rows = stmt
        .query_map([], row_from_sql)
        .map_err(|err| format!("contacts archived list query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("contacts archived list collect: {err}"))?;
    let mut out = Vec::with_capacity(rows.len());
    for mut row in rows {
        row.last_interaction_at = last_interaction_at(conn, &row.id)?;
        out.push(row);
    }
    Ok(out)
}

fn get_contact(conn: &Connection, id: &str) -> Result<Option<ContactRow>, String> {
    let row = conn
        .query_row(
            &format!(
                "SELECT {CONTACT_COLUMNS}
                   FROM contacts
                  WHERE id = ? AND archived_at IS NULL"
            ),
            params![id],
            row_from_sql,
        )
        .optional()
        .map_err(|err| format!("contacts get: {err}"))?;
    let mut row = match row {
        Some(value) => value,
        None => return Ok(None),
    };
    row.last_interaction_at = last_interaction_at(conn, &row.id)?;
    Ok(Some(row))
}

fn create_contact(conn: &Connection, params: ContactCreateParams) -> Result<ContactRow, String> {
    validate_birthday_components(params.birthday_month, params.birthday_day)?;
    let id = new_contact_id();
    let now = now_unix_ms();
    let display_name = normalize_name(params.display_name, DEFAULT_DISPLAY_NAME);
    let given_name = normalize_optional(params.given_name);
    let family_name = normalize_optional(params.family_name);
    let company = normalize_optional(params.company);
    let role = normalize_optional(params.role);
    let emails = normalize_methods(params.emails);
    let phones = normalize_methods(params.phones);
    let tags = normalize_tags(params.tags);
    let notes = normalize_notes(params.notes);
    let next_follow_up_at = normalize_follow_up_at(params.next_follow_up_at);
    let cadence_days = normalize_cadence_days(params.cadence_days);
    conn.execute(
        "INSERT INTO contacts
            (id, display_name, given_name, family_name, company, role,
             birthday_month, birthday_day, birthday_year,
             emails_json, phones_json, tags_json, notes,
             next_follow_up_at, cadence_days, pinned_at, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
        params![
            id,
            display_name,
            given_name,
            family_name,
            company,
            role,
            params.birthday_month,
            params.birthday_day,
            params.birthday_year,
            methods_to_json(&emails),
            methods_to_json(&phones),
            tags_to_json(&tags),
            notes,
            next_follow_up_at,
            cadence_days,
            now,
            now,
        ],
    )
    .map_err(|err| format!("contacts create insert: {err}"))?;
    get_contact(conn, &id)?.ok_or_else(|| "contacts create: created row disappeared".to_string())
}

fn update_contact(conn: &Connection, params: ContactUpdateParams) -> Result<ContactRow, String> {
    let id = normalize_id(&params.id)?;
    let existing = get_contact(conn, &id)?.ok_or_else(|| "contact was not found".to_string())?;
    let display_name = match params.display_name {
        Some(value) => normalize_name(Some(value), DEFAULT_DISPLAY_NAME),
        None => existing.display_name,
    };
    let given_name = match params.given_name {
        Some(next) => normalize_optional(next),
        None => existing.given_name,
    };
    let family_name = match params.family_name {
        Some(next) => normalize_optional(next),
        None => existing.family_name,
    };
    let company = match params.company {
        Some(next) => normalize_optional(next),
        None => existing.company,
    };
    let role = match params.role {
        Some(next) => normalize_optional(next),
        None => existing.role,
    };
    let birthday_month = match params.birthday_month {
        Some(next) => next,
        None => existing.birthday_month,
    };
    let birthday_day = match params.birthday_day {
        Some(next) => next,
        None => existing.birthday_day,
    };
    let birthday_year = match params.birthday_year {
        Some(next) => next,
        None => existing.birthday_year,
    };
    validate_birthday_components(birthday_month, birthday_day)?;
    let emails = match params.emails {
        Some(next) => normalize_methods(next),
        None => existing.emails,
    };
    let phones = match params.phones {
        Some(next) => normalize_methods(next),
        None => existing.phones,
    };
    let tags = match params.tags {
        Some(next) => normalize_tags(next),
        None => existing.tags,
    };
    let notes = match params.notes {
        Some(next) => normalize_notes(Some(next)),
        None => existing.notes,
    };
    let next_follow_up_at = match params.next_follow_up_at {
        Some(next) => normalize_follow_up_at(next),
        None => existing.next_follow_up_at,
    };
    let cadence_days = match params.cadence_days {
        Some(next) => normalize_cadence_days(next),
        None => existing.cadence_days,
    };
    let pinned_at = match params.pinned {
        Some(true) => Some(existing.pinned_at.unwrap_or_else(now_unix_ms)),
        Some(false) => None,
        None => existing.pinned_at,
    };
    let now = now_unix_ms();
    conn.execute(
        "UPDATE contacts
            SET display_name = ?, given_name = ?, family_name = ?, company = ?, role = ?,
                birthday_month = ?, birthday_day = ?, birthday_year = ?,
                emails_json = ?, phones_json = ?, tags_json = ?, notes = ?,
                next_follow_up_at = ?, cadence_days = ?, pinned_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![
            display_name,
            given_name,
            family_name,
            company,
            role,
            birthday_month,
            birthday_day,
            birthday_year,
            methods_to_json(&emails),
            methods_to_json(&phones),
            tags_to_json(&tags),
            notes,
            next_follow_up_at,
            cadence_days,
            pinned_at,
            now,
            id,
        ],
    )
    .map_err(|err| format!("contacts update: {err}"))?;
    get_contact(conn, &id)?.ok_or_else(|| "contacts update: updated row disappeared".to_string())
}

fn archive_contact(conn: &Connection, id: String) -> Result<(), String> {
    let id = normalize_id(&id)?;
    let now = now_unix_ms();
    conn.execute(
        "UPDATE contacts
            SET archived_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![now, now, id],
    )
    .map_err(|err| format!("contacts archive: {err}"))?;
    Ok(())
}

fn unarchive_contact(conn: &Connection, id: String) -> Result<ContactRow, String> {
    let id = normalize_id(&id)?;
    let now = now_unix_ms();
    conn.execute(
        "UPDATE contacts
            SET archived_at = NULL, updated_at = ?
          WHERE id = ? AND archived_at IS NOT NULL",
        params![now, id],
    )
    .map_err(|err| format!("contacts unarchive: {err}"))?;
    get_contact(conn, &id)?.ok_or_else(|| "contacts unarchive: row was not restored".to_string())
}

fn list_interactions(
    conn: &Connection,
    contact_id: &str,
) -> Result<Vec<ContactInteractionRow>, String> {
    let id = normalize_id(contact_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, contact_id, occurred_at, kind, note, source, created_at
               FROM contact_interactions
              WHERE contact_id = ?
              ORDER BY occurred_at DESC, created_at DESC",
        )
        .map_err(|err| format!("contact_interactions list prepare: {err}"))?;
    let rows = stmt
        .query_map(params![id], |row| {
            Ok(ContactInteractionRow {
                id: row.get(0)?,
                contact_id: row.get(1)?,
                occurred_at: row.get(2)?,
                kind: row.get(3)?,
                note: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|err| format!("contact_interactions list query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("contact_interactions list collect: {err}"))?;
    Ok(rows)
}

fn advance_follow_up_after_interaction(
    conn: &Connection,
    contact_id: &str,
    occurred_at: i64,
) -> Result<(), String> {
    let cadence_days = conn
        .query_row(
            "SELECT cadence_days FROM contacts WHERE id = ? AND archived_at IS NULL",
            params![contact_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(|err| format!("contact follow-up cadence lookup: {err}"))?
        .flatten();
    let Some(days) = cadence_days.filter(|value| *value > 0) else {
        return Ok(());
    };
    let next_follow_up_at = occurred_at.saturating_add(days.saturating_mul(86_400_000));
    let now = now_unix_ms();
    conn.execute(
        "UPDATE contacts
            SET next_follow_up_at = ?, updated_at = ?
          WHERE id = ? AND archived_at IS NULL",
        params![next_follow_up_at, now, contact_id],
    )
    .map_err(|err| format!("contact follow-up advance: {err}"))?;
    Ok(())
}

fn create_interaction(
    conn: &Connection,
    params: ContactInteractionCreateParams,
) -> Result<ContactInteractionRow, String> {
    let contact_id = normalize_id(&params.contact_id)?;
    if get_contact(conn, &contact_id)?.is_none() {
        return Err("contact was not found".to_string());
    }
    let kind = params.kind.trim();
    if kind.is_empty() {
        return Err("interaction kind is required".to_string());
    }
    let kind: String = kind.chars().take(48).collect();
    let occurred_at = params.occurred_at.unwrap_or_else(now_unix_ms);
    let note = params
        .note
        .unwrap_or_default()
        .trim()
        .chars()
        .take(MAX_INTERACTION_NOTE_CHARS)
        .collect::<String>();
    let source = params
        .source
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(MAX_NAME_CHARS).collect::<String>());
    let id = new_interaction_id();
    let now = now_unix_ms();
    conn.execute(
        "INSERT INTO contact_interactions
            (id, contact_id, occurred_at, kind, note, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![id, contact_id, occurred_at, kind, note, source, now],
    )
    .map_err(|err| format!("contact_interactions create: {err}"))?;
    advance_follow_up_after_interaction(conn, &contact_id, occurred_at)?;
    conn.query_row(
        "SELECT id, contact_id, occurred_at, kind, note, source, created_at
           FROM contact_interactions WHERE id = ?",
        params![id],
        |row| {
            Ok(ContactInteractionRow {
                id: row.get(0)?,
                contact_id: row.get(1)?,
                occurred_at: row.get(2)?,
                kind: row.get(3)?,
                note: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .map_err(|err| format!("contact_interactions read-back: {err}"))
}

fn update_interaction(
    conn: &Connection,
    params: ContactInteractionUpdateParams,
) -> Result<ContactInteractionRow, String> {
    let id = normalize_id(&params.id)?;
    let existing = conn
        .query_row(
            "SELECT id, contact_id, occurred_at, kind, note, source, created_at
               FROM contact_interactions WHERE id = ?",
            params![id],
            |row| {
                Ok(ContactInteractionRow {
                    id: row.get(0)?,
                    contact_id: row.get(1)?,
                    occurred_at: row.get(2)?,
                    kind: row.get(3)?,
                    note: row.get(4)?,
                    source: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|err| format!("contact_interactions update lookup: {err}"))?
        .ok_or_else(|| "interaction was not found".to_string())?;
    let occurred_at = params.occurred_at.unwrap_or(existing.occurred_at);
    let kind = match params.kind {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err("interaction kind cannot be empty".to_string());
            }
            trimmed.chars().take(48).collect::<String>()
        }
        None => existing.kind,
    };
    let note = match params.note {
        Some(next) => next
            .trim()
            .chars()
            .take(MAX_INTERACTION_NOTE_CHARS)
            .collect(),
        None => existing.note,
    };
    let source = match params.source {
        Some(next) => next
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(MAX_NAME_CHARS).collect::<String>()),
        None => existing.source.clone(),
    };
    conn.execute(
        "UPDATE contact_interactions
            SET occurred_at = ?, kind = ?, note = ?, source = ?
          WHERE id = ?",
        params![occurred_at, kind, note, source, id],
    )
    .map_err(|err| format!("contact_interactions update: {err}"))?;
    Ok(ContactInteractionRow {
        id,
        contact_id: existing.contact_id,
        occurred_at,
        kind,
        note,
        source,
        created_at: existing.created_at,
    })
}

fn delete_interaction(conn: &Connection, id: String) -> Result<(), String> {
    let id = normalize_id(&id)?;
    conn.execute("DELETE FROM contact_interactions WHERE id = ?", params![id])
        .map_err(|err| format!("contact_interactions delete: {err}"))?;
    Ok(())
}

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

fn search_contacts(
    conn: &Connection,
    params: ContactSearchParams,
) -> Result<Vec<ContactSearchResult>, String> {
    let query = params.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let Some(fts_query) = build_fts_query(query) else {
        return Ok(Vec::new());
    };
    // Same private-use Unicode delimiters as notes_search so the
    // frontend can run one mark-renderer for both surfaces. The
    // snippet is taken from the notes column (index 5) since it's
    // the longest free-text field; falling back to display_name
    // when the match was on a name field.
    let mut stmt = conn
        .prepare(
            "SELECT c.id,
                    c.display_name,
                    c.company,
                    snippet(contacts_fts, 5, char(57344), char(57345), '…', 12),
                    c.updated_at
               FROM contacts_fts
               JOIN contacts c ON c.rowid = contacts_fts.rowid
              WHERE contacts_fts MATCH ?
                AND c.archived_at IS NULL
              ORDER BY rank
              LIMIT 50",
        )
        .map_err(|err| format!("contacts_search prepare: {err}"))?;
    let mut rows = stmt
        .query_map(params![fts_query], |row| {
            Ok(ContactSearchResult {
                id: row.get(0)?,
                display_name: row.get(1)?,
                company: row.get(2)?,
                excerpt: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|err| format!("contacts_search query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("contacts_search collect: {err}"))?;
    let mut seen: std::collections::HashSet<String> =
        rows.iter().map(|row| row.id.clone()).collect();
    let like = format!("%{}%", query.to_lowercase());
    let mut json_stmt = conn
        .prepare(
            "SELECT id, display_name, company, updated_at
               FROM contacts
              WHERE archived_at IS NULL
                AND (
                  LOWER(emails_json) LIKE ?
                  OR LOWER(phones_json) LIKE ?
                  OR LOWER(tags_json) LIKE ?
                )
              ORDER BY updated_at DESC
              LIMIT 50",
        )
        .map_err(|err| format!("contacts_search json prepare: {err}"))?;
    let json_rows = json_stmt
        .query_map(params![&like, &like, &like], |row| {
            Ok(ContactSearchResult {
                id: row.get(0)?,
                display_name: row.get(1)?,
                company: row.get(2)?,
                excerpt: String::new(),
                updated_at: row.get(3)?,
            })
        })
        .map_err(|err| format!("contacts_search json query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("contacts_search json collect: {err}"))?;
    for row in json_rows {
        if seen.insert(row.id.clone()) {
            rows.push(row);
        }
        if rows.len() >= 50 {
            break;
        }
    }
    Ok(rows)
}

/// Compute the next occurrence (in days from `today`) of a given
/// (month, day) anchor. Treats Feb 29 birthdays as Mar 1 in non-leap
/// years rather than skipping — matches Apple Calendar's behavior.
fn days_until_next_occurrence(
    today: chrono::NaiveDate,
    month: u32,
    day: u32,
) -> Option<(i64, chrono::NaiveDate)> {
    use chrono::NaiveDate;
    fn try_date(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
        // Feb 29 in non-leap years rolls forward to Mar 1 so the
        // birthday still surfaces every year.
        NaiveDate::from_ymd_opt(year, month, day).or_else(|| {
            if month == 2 && day == 29 {
                NaiveDate::from_ymd_opt(year, 3, 1)
            } else {
                None
            }
        })
    }
    let candidate = try_date(today.year(), month, day)?;
    let next = if candidate >= today {
        candidate
    } else {
        try_date(today.year() + 1, month, day)?
    };
    let diff = (next - today).num_days();
    Some((diff, next))
}

fn upcoming_birthdays(
    conn: &Connection,
    params: UpcomingBirthdayParams,
) -> Result<Vec<UpcomingBirthday>, String> {
    let horizon = params.days_ahead.unwrap_or(30).max(0).min(365);
    let mut stmt = conn
        .prepare(
            "SELECT id, display_name, birthday_month, birthday_day, birthday_year
               FROM contacts
              WHERE archived_at IS NULL
                AND birthday_month IS NOT NULL
                AND birthday_day IS NOT NULL",
        )
        .map_err(|err| format!("contacts birthdays prepare: {err}"))?;
    let raw = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|err| format!("contacts birthdays query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("contacts birthdays collect: {err}"))?;
    let today = Local::now().date_naive();
    let mut out: Vec<UpcomingBirthday> = Vec::new();
    for (id, name, month, day, year) in raw {
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            continue;
        }
        let Some((days_until, next)) = days_until_next_occurrence(today, month as u32, day as u32)
        else {
            continue;
        };
        if days_until > horizon {
            continue;
        }
        let turning_age = year.map(|y| (next.year() as i64) - y);
        out.push(UpcomingBirthday {
            contact_id: id,
            display_name: name,
            birthday_month: month,
            birthday_day: day,
            birthday_year: year,
            days_until,
            turning_age,
        });
    }
    out.sort_by_key(|b| b.days_until);
    Ok(out)
}

#[tauri::command]
pub async fn contacts_list(app: tauri::AppHandle) -> Result<Vec<ContactRow>, String> {
    let conn = local_db::open(&app)?;
    list_contacts(&conn)
}

#[tauri::command]
pub async fn contacts_list_archived(app: tauri::AppHandle) -> Result<Vec<ContactRow>, String> {
    let conn = local_db::open(&app)?;
    list_archived_contacts(&conn)
}

#[tauri::command]
pub async fn contacts_get(app: tauri::AppHandle, id: String) -> Result<Option<ContactRow>, String> {
    let conn = local_db::open(&app)?;
    get_contact(&conn, &id)
}

#[tauri::command]
pub async fn contacts_create(
    app: tauri::AppHandle,
    params: ContactCreateParams,
) -> Result<ContactRow, String> {
    let conn = local_db::open(&app)?;
    create_contact(&conn, params)
}

#[tauri::command]
pub async fn contacts_update(
    app: tauri::AppHandle,
    params: ContactUpdateParams,
) -> Result<ContactRow, String> {
    let conn = local_db::open(&app)?;
    update_contact(&conn, params)
}

#[tauri::command]
pub async fn contacts_archive(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    archive_contact(&conn, id)
}

#[tauri::command]
pub async fn contacts_unarchive(app: tauri::AppHandle, id: String) -> Result<ContactRow, String> {
    let conn = local_db::open(&app)?;
    unarchive_contact(&conn, id)
}

#[tauri::command]
pub async fn contacts_search(
    app: tauri::AppHandle,
    params: ContactSearchParams,
) -> Result<Vec<ContactSearchResult>, String> {
    let conn = local_db::open(&app)?;
    search_contacts(&conn, params)
}

#[tauri::command]
pub async fn contacts_upcoming_birthdays(
    app: tauri::AppHandle,
    params: UpcomingBirthdayParams,
) -> Result<Vec<UpcomingBirthday>, String> {
    let conn = local_db::open(&app)?;
    upcoming_birthdays(&conn, params)
}

#[tauri::command]
pub async fn contact_interactions_list(
    app: tauri::AppHandle,
    contact_id: String,
) -> Result<Vec<ContactInteractionRow>, String> {
    let conn = local_db::open(&app)?;
    list_interactions(&conn, &contact_id)
}

#[tauri::command]
pub async fn contact_interactions_create(
    app: tauri::AppHandle,
    params: ContactInteractionCreateParams,
) -> Result<ContactInteractionRow, String> {
    let conn = local_db::open(&app)?;
    create_interaction(&conn, params)
}

#[tauri::command]
pub async fn contact_interactions_update(
    app: tauri::AppHandle,
    params: ContactInteractionUpdateParams,
) -> Result<ContactInteractionRow, String> {
    let conn = local_db::open(&app)?;
    update_interaction(&conn, params)
}

#[tauri::command]
pub async fn contact_interactions_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = local_db::open(&app)?;
    delete_interaction(&conn, id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactBacklink {
    pub note_id: String,
    pub note_title: String,
    pub note_icon: Option<String>,
    pub mention_text: String,
    pub char_offset: i64,
    pub mentioned_at: i64,
    pub note_updated_at: i64,
}

/// One match produced by the `@`-name resolver. Stored verbatim in
/// `note_contact_mentions` so the UI can highlight or jump to the
/// exact substring later.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedMention {
    pub contact_id: String,
    pub mention_text: String,
    pub char_offset: i64,
}

/// Walk a note body and emit one `ResolvedMention` per `@<name>`
/// occurrence whose suffix exactly matches a contact's display name.
/// Multiple contacts sharing a name are deduped (we keep the first by
/// `created_at` ordering — the caller passes contacts in stable order),
/// and longer matches win over shorter ones at the same anchor:
/// `@Alice Wong` resolves to "Alice Wong" before falling back to
/// "Alice". `@` followed by something we can't resolve is silently
/// ignored — the user sees no chip but no crash either.
pub fn resolve_mentions(body: &str, contacts: &[(String, String)]) -> Vec<ResolvedMention> {
    if body.is_empty() || contacts.is_empty() {
        return Vec::new();
    }
    // Sort contacts by descending display-name length so the longest
    // match for a given anchor wins. A tie keeps the input order so
    // the caller controls precedence.
    let mut sorted: Vec<&(String, String)> = contacts.iter().collect();
    sorted.sort_by(|a, b| {
        b.1.chars()
            .count()
            .cmp(&a.1.chars().count())
            .then(a.1.cmp(&b.1))
    });

    let bytes = body.as_bytes();
    let body_len = bytes.len();
    let mut out: Vec<ResolvedMention> = Vec::new();
    // Track the byte offset where the previous accepted match ended so
    // we don't claim "Alice" inside "Alice Wong" as a second mention.
    let mut consumed_until: usize = 0;
    let mut i = 0;
    while i < body_len {
        if bytes[i] != b'@' {
            i += 1;
            continue;
        }
        if i < consumed_until {
            i += 1;
            continue;
        }
        // The `@` must start a word — preceding char must be whitespace,
        // punctuation, or string start. Otherwise an email "x@y.com"
        // would be treated as a mention.
        if i > 0 {
            let prev = bytes[i - 1];
            if prev.is_ascii_alphanumeric() || prev == b'_' {
                i += 1;
                continue;
            }
        }
        let suffix = &body[i + 1..];
        let mut best: Option<ResolvedMention> = None;
        for (contact_id, name) in sorted.iter() {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                continue;
            }
            if suffix.len() < trimmed.len() {
                continue;
            }
            // Case-insensitive prefix match using char-by-char
            // comparison — handles ASCII + most CJK without allocating
            // a normalised lowercase copy.
            let suffix_chars = suffix.chars();
            let name_chars = trimmed.chars();
            let mut suffix_iter = suffix_chars;
            let mut name_iter = name_chars;
            let mut matched_chars = 0usize;
            let mut matched_bytes = 0usize;
            let mut ok = true;
            loop {
                let n = name_iter.next();
                let s = suffix_iter.next();
                match (n, s) {
                    (None, _) => break,
                    (Some(_), None) => {
                        ok = false;
                        break;
                    }
                    (Some(nc), Some(sc)) => {
                        if !chars_equal_ignore_ascii_case(nc, sc) {
                            ok = false;
                            break;
                        }
                        matched_chars += 1;
                        matched_bytes += sc.len_utf8();
                    }
                }
            }
            let _ = matched_chars;
            if !ok {
                continue;
            }
            // Boundary: the char right after the match must not extend
            // the word, otherwise `@Alice` shouldn't claim "Alic" of
            // "Alice".
            let after_byte_offset = matched_bytes;
            if let Some(next_char) = suffix[after_byte_offset..].chars().next() {
                if next_char.is_alphanumeric() || next_char == '_' {
                    continue;
                }
            }
            // We have a valid match. Because we walk the sorted list
            // longest-first, the first acceptable match is the best.
            best = Some(ResolvedMention {
                contact_id: (*contact_id).clone(),
                mention_text: suffix[..after_byte_offset].to_string(),
                char_offset: i as i64,
            });
            break;
        }
        if let Some(resolved) = best {
            // Advance past the consumed chunk: `@` + match length.
            let consumed = 1 + resolved.mention_text.len();
            consumed_until = i + consumed;
            out.push(resolved);
            i = consumed_until;
        } else {
            i += 1;
        }
    }
    out
}

fn chars_equal_ignore_ascii_case(a: char, b: char) -> bool {
    if a == b {
        return true;
    }
    if a.is_ascii_alphabetic() && b.is_ascii_alphabetic() {
        return a.to_ascii_lowercase() == b.to_ascii_lowercase();
    }
    false
}

/// Re-sync mentions for a note. Idempotent — call after every
/// `notes_create` or `notes_update` that touches the body. Uses a
/// transaction so partial writes never leave half-resolved rows
/// behind. Returns the number of new rows inserted (helpful for the
/// caller's optimistic UI).
pub fn sync_note_mentions(conn: &Connection, note_id: &str, body: &str) -> Result<usize, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, display_name FROM contacts
              WHERE archived_at IS NULL
              ORDER BY created_at, id",
        )
        .map_err(|err| format!("sync_note_mentions: prepare contacts: {err}"))?;
    let contacts = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| format!("sync_note_mentions: query contacts: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("sync_note_mentions: collect contacts: {err}"))?;
    drop(stmt);
    let resolved = resolve_mentions(body, &contacts);
    let now = now_unix_ms();

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| format!("sync_note_mentions: transaction begin: {err}"))?;
    tx.execute(
        "DELETE FROM note_contact_mentions WHERE note_id = ?",
        params![note_id],
    )
    .map_err(|err| format!("sync_note_mentions: clear: {err}"))?;
    let mut inserted = 0;
    {
        let mut stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO note_contact_mentions
                    (note_id, contact_id, mention_text, char_offset, created_at)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .map_err(|err| format!("sync_note_mentions: prepare insert: {err}"))?;
        for mention in &resolved {
            stmt.execute(params![
                note_id,
                mention.contact_id,
                mention.mention_text,
                mention.char_offset,
                now,
            ])
            .map_err(|err| format!("sync_note_mentions: insert: {err}"))?;
            inserted += 1;
        }
    }
    tx.commit()
        .map_err(|err| format!("sync_note_mentions: commit: {err}"))?;
    Ok(inserted)
}

fn list_backlinks_for_contact(
    conn: &Connection,
    contact_id: &str,
) -> Result<Vec<ContactBacklink>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.title, n.icon, m.mention_text, m.char_offset,
                    m.created_at, n.updated_at
               FROM note_contact_mentions m
               JOIN notes n ON n.id = m.note_id
              WHERE m.contact_id = ?
                AND n.archived_at IS NULL
              ORDER BY n.updated_at DESC, m.created_at DESC",
        )
        .map_err(|err| format!("list_backlinks prepare: {err}"))?;
    let rows = stmt
        .query_map(params![contact_id], |row| {
            Ok(ContactBacklink {
                note_id: row.get(0)?,
                note_title: row.get(1)?,
                note_icon: row.get(2)?,
                mention_text: row.get(3)?,
                char_offset: row.get(4)?,
                mentioned_at: row.get(5)?,
                note_updated_at: row.get(6)?,
            })
        })
        .map_err(|err| format!("list_backlinks query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("list_backlinks collect: {err}"))?;
    Ok(rows)
}

#[tauri::command]
pub async fn contacts_list_backlinks(
    app: tauri::AppHandle,
    contact_id: String,
) -> Result<Vec<ContactBacklink>, String> {
    let conn = local_db::open(&app)?;
    list_backlinks_for_contact(&conn, &contact_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeriveCalendarInteractionsParams {
    /// ISO 8601 inclusive lower bound. Defaults to "30 days ago" when None.
    pub starts_at: Option<String>,
    /// ISO 8601 exclusive upper bound. Defaults to "now" when None.
    pub ends_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeriveCalendarInteractionsResult {
    pub created: u64,
    pub skipped: u64,
    pub events_scanned: u64,
    pub contacts_touched: u64,
}

/// Lookup table for "any contact whose emails contain `email`". Built
/// once at the start of a sweep so we don't run a full-table scan per
/// event. The map's value is the contact id; primary lookup on
/// lowercased email since contact_emails come back lowercased from
/// `participant_email` and we lowercase contact entries on the way in.
fn build_email_index(
    conn: &Connection,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT id, emails_json FROM contacts WHERE archived_at IS NULL")
        .map_err(|err| format!("derive build_email_index prepare: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| format!("derive build_email_index query: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("derive build_email_index collect: {err}"))?;
    let mut out = std::collections::HashMap::with_capacity(rows.len());
    for (id, json) in rows {
        let methods = methods_from_json(&json);
        for method in methods {
            let email = method.value.trim().to_ascii_lowercase();
            if email.is_empty() || !email.contains('@') {
                continue;
            }
            // First contact wins on collision — same email shouldn't
            // legitimately point at two different people.
            out.entry(email).or_insert_with(|| id.clone());
        }
    }
    Ok(out)
}

/// Returns true when an interaction with this `source` already exists.
/// We use the unique-ish `source` slot (`calendar:<eventId>:<contactId>`)
/// as the dedupe key so re-running the sweep is idempotent.
fn interaction_source_exists(conn: &Connection, source: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM contact_interactions WHERE source = ?",
            params![source],
            |row| row.get(0),
        )
        .map_err(|err| format!("derive source-exists check: {err}"))?;
    Ok(count > 0)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn contacts_derive_calendar_interactions(
    app: tauri::AppHandle,
    params: DeriveCalendarInteractionsParams,
) -> Result<DeriveCalendarInteractionsResult, String> {
    use chrono::Duration;

    let now = Utc::now();
    let starts_at = params
        .starts_at
        .unwrap_or_else(|| (now - Duration::days(30)).to_rfc3339());
    let ends_at = params.ends_at.unwrap_or_else(|| now.to_rfc3339());

    let bundles = crate::calendar::eventkit::fetch_events_with_attendees(
        &crate::calendar::types::FetchEventsRequest {
            starts_at: starts_at.clone(),
            ends_at: ends_at.clone(),
            calendar_ids: Vec::new(),
        },
    )?;

    let conn = local_db::open(&app)?;
    let index = build_email_index(&conn)?;
    let mut created: u64 = 0;
    let mut skipped: u64 = 0;
    let mut touched: std::collections::HashSet<String> = std::collections::HashSet::new();
    let events_scanned = bundles.len() as u64;

    for bundle in bundles {
        // Skip degenerate events that EventKit emitted without an id —
        // we'd have no source key to dedupe against.
        if bundle.event_identifier.is_empty() {
            continue;
        }
        let occurred_at_ms = match chrono::DateTime::parse_from_rfc3339(&bundle.starts_at) {
            Ok(dt) => dt.with_timezone(&Utc).timestamp_millis(),
            Err(_) => continue,
        };
        let kind_label = "meeting".to_string();
        // One interaction per (event, contact) pair. We dedupe on
        // (event_id, contact_id) so a recurring "Standup" series only
        // produces one row per occurrence per participant.
        let mut event_contacts: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for attendee in &bundle.attendees {
            if attendee.is_current_user {
                continue;
            }
            let Some(email) = attendee.email.as_deref() else {
                continue;
            };
            let Some(contact_id) = index.get(&email.to_ascii_lowercase()) else {
                continue;
            };
            if !event_contacts.insert(contact_id.clone()) {
                continue;
            }
            let source = format!("calendar:{}:{}", bundle.event_identifier, contact_id);
            if interaction_source_exists(&conn, &source)? {
                skipped += 1;
                continue;
            }
            create_interaction(
                &conn,
                ContactInteractionCreateParams {
                    contact_id: contact_id.clone(),
                    occurred_at: Some(occurred_at_ms),
                    kind: kind_label.clone(),
                    note: if bundle.title.trim().is_empty() {
                        None
                    } else {
                        Some(bundle.title.clone())
                    },
                    source: Some(source),
                },
            )?;
            created += 1;
            touched.insert(contact_id.clone());
        }
    }

    Ok(DeriveCalendarInteractionsResult {
        created,
        skipped,
        events_scanned,
        contacts_touched: touched.len() as u64,
    })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn contacts_derive_calendar_interactions(
    _app: tauri::AppHandle,
    _params: DeriveCalendarInteractionsParams,
) -> Result<DeriveCalendarInteractionsResult, String> {
    Err("Calendar attendee derivation is only available on macOS in this build".to_string())
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

    fn make_contact(conn: &Connection, name: &str) -> ContactRow {
        create_contact(
            conn,
            ContactCreateParams {
                display_name: Some(name.to_string()),
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: None,
                birthday_day: None,
                birthday_year: None,
                emails: vec![],
                phones: vec![],
                tags: vec![],
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
            },
        )
        .expect("create contact")
    }

    fn empty_update(id: String) -> ContactUpdateParams {
        ContactUpdateParams {
            id,
            display_name: None,
            given_name: None,
            family_name: None,
            company: None,
            role: None,
            birthday_month: None,
            birthday_day: None,
            birthday_year: None,
            emails: None,
            phones: None,
            tags: None,
            notes: None,
            next_follow_up_at: None,
            cadence_days: None,
            pinned: None,
        }
    }

    #[test]
    fn create_normalizes_inputs_and_dedupes_methods_and_tags() {
        let conn = test_conn();
        let row = create_contact(
            &conn,
            ContactCreateParams {
                display_name: Some("   Alice Wong  ".to_string()),
                given_name: Some(" Alice ".to_string()),
                family_name: None,
                company: Some("Linear".to_string()),
                role: Some("PM".to_string()),
                birthday_month: Some(7),
                birthday_day: Some(14),
                birthday_year: Some(1991),
                emails: vec![
                    ContactMethod {
                        value: "  Alice@example.com  ".to_string(),
                        label: Some("work".to_string()),
                        is_primary: true,
                    },
                    ContactMethod {
                        value: "alice@EXAMPLE.com".to_string(),
                        label: Some("dup".to_string()),
                        is_primary: false,
                    },
                    ContactMethod {
                        value: "alice@personal.com".to_string(),
                        label: None,
                        is_primary: false,
                    },
                ],
                phones: vec![],
                tags: vec![
                    "Friend".to_string(),
                    "  friend ".to_string(),
                    "PM".to_string(),
                ],
                notes: Some("Met at the team offsite.".to_string()),
                next_follow_up_at: Some(1_700_000_000_000),
                cadence_days: Some(30),
            },
        )
        .expect("create");

        assert!(row.id.starts_with(CONTACT_ID_PREFIX));
        assert_eq!(row.display_name, "Alice Wong");
        assert_eq!(row.given_name.as_deref(), Some("Alice"));
        assert_eq!(row.company.as_deref(), Some("Linear"));
        assert_eq!(row.emails.len(), 2);
        assert_eq!(row.emails[0].value, "Alice@example.com");
        assert!(row.emails[0].is_primary);
        assert_eq!(row.emails[1].value, "alice@personal.com");
        assert_eq!(row.tags, vec!["Friend".to_string(), "PM".to_string()]);
        assert_eq!(row.birthday_month, Some(7));
        assert_eq!(row.birthday_day, Some(14));
        assert_eq!(row.birthday_year, Some(1991));
        assert_eq!(row.last_interaction_at, None);
    }

    #[test]
    fn birthday_validation_rejects_partial_dates_and_out_of_range() {
        let conn = test_conn();
        let bad_partial = create_contact(
            &conn,
            ContactCreateParams {
                display_name: Some("Bob".to_string()),
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: Some(7),
                birthday_day: None,
                birthday_year: None,
                emails: vec![],
                phones: vec![],
                tags: vec![],
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
            },
        );
        assert!(bad_partial.unwrap_err().contains("month and day"));

        let bad_month = create_contact(
            &conn,
            ContactCreateParams {
                display_name: Some("Bob".to_string()),
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: Some(13),
                birthday_day: Some(1),
                birthday_year: None,
                emails: vec![],
                phones: vec![],
                tags: vec![],
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
            },
        );
        assert!(bad_month.unwrap_err().contains("Invalid birthday month"));

        let bad_date = create_contact(
            &conn,
            ContactCreateParams {
                display_name: Some("Bob".to_string()),
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: Some(4),
                birthday_day: Some(31),
                birthday_year: None,
                emails: vec![],
                phones: vec![],
                tags: vec![],
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
            },
        );
        assert!(bad_date.unwrap_err().contains("Invalid birthday date"));
    }

    #[test]
    fn list_contacts_orders_pinned_first_then_alphabetical_and_skips_archived() {
        let conn = test_conn();
        let zoe = make_contact(&conn, "Zoe");
        let alice = make_contact(&conn, "Alice");
        let bob = make_contact(&conn, "Bob");
        let archived = make_contact(&conn, "Archived");
        archive_contact(&conn, archived.id.clone()).expect("archive");

        update_contact(
            &conn,
            ContactUpdateParams {
                id: zoe.id.clone(),
                display_name: None,
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: None,
                birthday_day: None,
                birthday_year: None,
                emails: None,
                phones: None,
                tags: None,
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
                pinned: Some(true),
            },
        )
        .expect("pin");

        let listed = list_contacts(&conn).expect("list");
        let names: Vec<_> = listed.iter().map(|c| c.display_name.as_str()).collect();
        assert_eq!(names, vec!["Zoe", "Alice", "Bob"]);
        assert!(listed[0].pinned_at.is_some());
        assert!(!names.contains(&"Archived"));
        let _ = bob;
        let _ = alice;
    }

    #[test]
    fn last_interaction_at_reflects_most_recent_log_entry() {
        let conn = test_conn();
        let contact = make_contact(&conn, "Alice");

        let first = create_interaction(
            &conn,
            ContactInteractionCreateParams {
                contact_id: contact.id.clone(),
                occurred_at: Some(1_000),
                kind: "meeting".to_string(),
                note: Some("Coffee".to_string()),
                source: None,
            },
        )
        .expect("first log");
        assert_eq!(first.kind, "meeting");

        let _second = create_interaction(
            &conn,
            ContactInteractionCreateParams {
                contact_id: contact.id.clone(),
                occurred_at: Some(2_500),
                kind: "call".to_string(),
                note: None,
                source: None,
            },
        )
        .expect("second log");

        let refreshed = get_contact(&conn, &contact.id)
            .expect("get")
            .expect("contact present");
        assert_eq!(refreshed.last_interaction_at, Some(2_500));

        let logs = list_interactions(&conn, &contact.id).expect("logs");
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].occurred_at, 2_500);
    }

    #[test]
    fn cadence_advances_next_follow_up_after_interaction() {
        let conn = test_conn();
        let contact = make_contact(&conn, "Alice");
        let mut update = empty_update(contact.id.clone());
        update.next_follow_up_at = Some(Some(1_000));
        update.cadence_days = Some(Some(14));
        let scheduled = update_contact(&conn, update).expect("schedule");
        assert_eq!(scheduled.next_follow_up_at, Some(1_000));
        assert_eq!(scheduled.cadence_days, Some(14));

        create_interaction(
            &conn,
            ContactInteractionCreateParams {
                contact_id: contact.id.clone(),
                occurred_at: Some(10_000),
                kind: "meeting".to_string(),
                note: None,
                source: None,
            },
        )
        .expect("interaction");

        let refreshed = get_contact(&conn, &contact.id)
            .expect("get")
            .expect("contact present");
        assert_eq!(refreshed.next_follow_up_at, Some(10_000 + 14 * 86_400_000));
    }

    #[test]
    fn archived_contacts_can_be_listed_and_restored() {
        let conn = test_conn();
        let contact = make_contact(&conn, "Archived Alice");
        archive_contact(&conn, contact.id.clone()).expect("archive");

        let active = list_contacts(&conn).expect("active list");
        assert!(active.iter().all(|row| row.id != contact.id));
        let archived = list_archived_contacts(&conn).expect("archived list");
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].id, contact.id);

        let restored = unarchive_contact(&conn, contact.id.clone()).expect("restore");
        assert_eq!(restored.archived_at, None);
        let active = list_contacts(&conn).expect("active list after restore");
        assert!(active.iter().any(|row| row.id == contact.id));
    }

    #[test]
    fn search_finds_contacts_by_name_and_notes() {
        let conn = test_conn();
        let _alice = create_contact(
            &conn,
            ContactCreateParams {
                display_name: Some("Alice Wong".to_string()),
                given_name: None,
                family_name: None,
                company: Some("Linear".to_string()),
                role: None,
                birthday_month: None,
                birthday_day: None,
                birthday_year: None,
                emails: vec![ContactMethod {
                    value: "alice@example.com".to_string(),
                    label: Some("work".to_string()),
                    is_primary: true,
                }],
                phones: vec![],
                tags: vec!["Investor".to_string()],
                notes: Some("Met at the React Conf hallway track.".to_string()),
                next_follow_up_at: None,
                cadence_days: None,
            },
        )
        .expect("create alice");
        let _bob = create_contact(
            &conn,
            ContactCreateParams {
                display_name: Some("Bob Tanaka".to_string()),
                given_name: None,
                family_name: None,
                company: Some("Anthropic".to_string()),
                role: None,
                birthday_month: None,
                birthday_day: None,
                birthday_year: None,
                emails: vec![],
                phones: vec![],
                tags: vec![],
                notes: Some("Met via Slack DM.".to_string()),
                next_follow_up_at: None,
                cadence_days: None,
            },
        )
        .expect("create bob");

        let by_name = search_contacts(
            &conn,
            ContactSearchParams {
                query: "alice".to_string(),
            },
        )
        .expect("search alice");
        assert_eq!(by_name.len(), 1);
        assert_eq!(by_name[0].display_name, "Alice Wong");

        let by_company = search_contacts(
            &conn,
            ContactSearchParams {
                query: "anthropic".to_string(),
            },
        )
        .expect("search anthropic");
        assert_eq!(by_company.len(), 1);
        assert_eq!(by_company[0].display_name, "Bob Tanaka");

        let by_email = search_contacts(
            &conn,
            ContactSearchParams {
                query: "alice@example.com".to_string(),
            },
        )
        .expect("search email");
        assert_eq!(by_email.len(), 1);
        assert_eq!(by_email[0].display_name, "Alice Wong");

        let by_tag = search_contacts(
            &conn,
            ContactSearchParams {
                query: "investor".to_string(),
            },
        )
        .expect("search tag");
        assert_eq!(by_tag.len(), 1);
        assert_eq!(by_tag[0].display_name, "Alice Wong");

        let no_match = search_contacts(
            &conn,
            ContactSearchParams {
                query: "nonexistent".to_string(),
            },
        )
        .expect("search nope");
        assert!(no_match.is_empty());
    }

    #[test]
    fn upcoming_birthdays_returns_within_horizon_and_skips_others() {
        let conn = test_conn();
        // We can't pin "today" without injecting a clock, but we can
        // assert the sort + filter behaviour by creating contacts at
        // month boundaries and reading the result back.
        let today = Local::now().date_naive();
        // 1) Birthday today.
        let today_birthday = create_contact(
            &conn,
            ContactCreateParams {
                display_name: Some("Today".to_string()),
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: Some(today.month() as i64),
                birthday_day: Some(today.day() as i64),
                birthday_year: Some(1990),
                emails: vec![],
                phones: vec![],
                tags: vec![],
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
            },
        )
        .expect("create today");
        // 2) Birthday outside the 30-day horizon (90 days ahead).
        let far = today + chrono::Duration::days(90);
        let _later = create_contact(
            &conn,
            ContactCreateParams {
                display_name: Some("Later".to_string()),
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: Some(far.month() as i64),
                birthday_day: Some(far.day() as i64),
                birthday_year: None,
                emails: vec![],
                phones: vec![],
                tags: vec![],
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
            },
        )
        .expect("create later");

        let upcoming = upcoming_birthdays(
            &conn,
            UpcomingBirthdayParams {
                days_ahead: Some(30),
            },
        )
        .expect("upcoming");
        let ids: Vec<_> = upcoming.iter().map(|b| b.contact_id.as_str()).collect();
        assert!(ids.contains(&today_birthday.id.as_str()));
        assert!(!ids.iter().any(|id| id.contains("later")));
        let today_entry = upcoming
            .iter()
            .find(|b| b.contact_id == today_birthday.id)
            .expect("today entry");
        assert_eq!(today_entry.days_until, 0);
        assert!(today_entry.turning_age.is_some());
    }

    #[test]
    fn pin_toggles_pinned_at_and_unpin_clears_it() {
        let conn = test_conn();
        let contact = make_contact(&conn, "Alice");
        let pinned = update_contact(
            &conn,
            ContactUpdateParams {
                id: contact.id.clone(),
                display_name: None,
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: None,
                birthday_day: None,
                birthday_year: None,
                emails: None,
                phones: None,
                tags: None,
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
                pinned: Some(true),
            },
        )
        .expect("pin");
        assert!(pinned.pinned_at.is_some());
        let unpinned = update_contact(
            &conn,
            ContactUpdateParams {
                id: contact.id.clone(),
                display_name: None,
                given_name: None,
                family_name: None,
                company: None,
                role: None,
                birthday_month: None,
                birthday_day: None,
                birthday_year: None,
                emails: None,
                phones: None,
                tags: None,
                notes: None,
                next_follow_up_at: None,
                cadence_days: None,
                pinned: Some(false),
            },
        )
        .expect("unpin");
        assert!(unpinned.pinned_at.is_none());
    }

    #[test]
    fn resolve_mentions_handles_basic_cases_and_skips_emails() {
        let contacts = vec![
            ("ctc_alice".to_string(), "Alice Wong".to_string()),
            ("ctc_bob".to_string(), "Bob".to_string()),
            ("ctc_charlie".to_string(), "陈晨".to_string()),
        ];

        // Plain mention.
        let r = resolve_mentions("Talked with @Alice Wong today.", &contacts);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].contact_id, "ctc_alice");
        assert_eq!(r[0].mention_text, "Alice Wong");

        // Longest match wins: "Alice Wong" should be picked over "Alice"
        // even though the contact list has both possibilities.
        let with_overlap = vec![
            ("ctc_short".to_string(), "Alice".to_string()),
            ("ctc_long".to_string(), "Alice Wong".to_string()),
        ];
        let r2 = resolve_mentions("ping @Alice Wong please", &with_overlap);
        assert_eq!(r2.len(), 1);
        assert_eq!(r2[0].contact_id, "ctc_long");

        // Email shouldn't trip the resolver — `x@Alice` has prev=alpha.
        let r3 = resolve_mentions("Reply to alice@Alice Wong.com", &contacts);
        assert!(r3.is_empty());

        // CJK contact name resolves at boundary.
        let r4 = resolve_mentions("和 @陈晨 一起开的会", &contacts);
        assert_eq!(r4.len(), 1);
        assert_eq!(r4[0].contact_id, "ctc_charlie");
        assert_eq!(r4[0].mention_text, "陈晨");

        // Unmatched `@token` is silently dropped.
        let r5 = resolve_mentions("Saw @Stranger today.", &contacts);
        assert!(r5.is_empty());

        // Multiple mentions preserve order.
        let r6 = resolve_mentions("@Bob and @Alice Wong shipped it.", &contacts);
        assert_eq!(r6.len(), 2);
        assert_eq!(r6[0].contact_id, "ctc_bob");
        assert_eq!(r6[1].contact_id, "ctc_alice");
    }

    #[test]
    fn sync_note_mentions_is_idempotent_and_diffs_on_resync() {
        let conn = test_conn();
        let alice = make_contact(&conn, "Alice");
        let bob = make_contact(&conn, "Bob");

        // Seed a note row directly so we don't pull in notes.rs's full
        // create flow for this unit-level test.
        conn.execute(
            "INSERT INTO notes (id, title, body_mdx, sort_order, created_at, updated_at)
             VALUES ('note_1', 'Standup', '', 0, 1, 1)",
            [],
        )
        .expect("seed note");

        let inserted =
            sync_note_mentions(&conn, "note_1", "@Alice and @Bob shipped it").expect("first sync");
        assert_eq!(inserted, 2);

        // Re-running with the same body should keep the same set.
        let again =
            sync_note_mentions(&conn, "note_1", "@Alice and @Bob shipped it").expect("re-sync");
        assert_eq!(again, 2);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_contact_mentions WHERE note_id = 'note_1'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 2);

        // Editing the body to drop Bob removes that backlink.
        let dropped =
            sync_note_mentions(&conn, "note_1", "Just @Alice this time").expect("drop bob");
        assert_eq!(dropped, 1);
        let only_alice: Vec<String> = conn
            .prepare("SELECT contact_id FROM note_contact_mentions WHERE note_id = 'note_1'")
            .expect("prepare")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("collect");
        assert_eq!(only_alice, vec![alice.id.clone()]);
        let _ = bob;
    }

    #[test]
    fn list_backlinks_for_contact_returns_matching_notes_only() {
        let conn = test_conn();
        let alice = make_contact(&conn, "Alice");
        let _bob = make_contact(&conn, "Bob");
        for (id, body) in [
            ("note_a", "Met with @Alice this morning"),
            ("note_b", "Quick @Bob ping"),
            ("note_c", "Both @Alice and @Bob"),
        ] {
            conn.execute(
                "INSERT INTO notes (id, title, body_mdx, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, 0, 100, 200)",
                params![id, id, body],
            )
            .expect("seed note");
            sync_note_mentions(&conn, id, body).expect("sync");
        }
        let alice_links = list_backlinks_for_contact(&conn, &alice.id).expect("backlinks");
        let titles: Vec<_> = alice_links.iter().map(|l| l.note_title.as_str()).collect();
        assert!(titles.contains(&"note_a"));
        assert!(titles.contains(&"note_c"));
        assert!(!titles.contains(&"note_b"));
    }

    #[test]
    fn deleting_an_interaction_removes_just_that_row() {
        let conn = test_conn();
        let contact = make_contact(&conn, "Alice");
        let first = create_interaction(
            &conn,
            ContactInteractionCreateParams {
                contact_id: contact.id.clone(),
                occurred_at: Some(1_000),
                kind: "meeting".to_string(),
                note: Some("First".to_string()),
                source: None,
            },
        )
        .expect("first");
        let _second = create_interaction(
            &conn,
            ContactInteractionCreateParams {
                contact_id: contact.id.clone(),
                occurred_at: Some(2_000),
                kind: "call".to_string(),
                note: Some("Second".to_string()),
                source: None,
            },
        )
        .expect("second");
        delete_interaction(&conn, first.id.clone()).expect("delete");
        let logs = list_interactions(&conn, &contact.id).expect("list");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].kind, "call");
    }
}
