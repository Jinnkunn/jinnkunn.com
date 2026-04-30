//! Rust mirrors of the TypeScript types in
//! `src/surfaces/calendar/types.ts`. Field names are intentionally
//! camelCase via `serde(rename_all)` so the webview receives the same
//! shape it declared in TS — keep the two files in lockstep.

use serde::{Deserialize, Serialize};

/// Mirror of `EKAuthorizationStatus`. `WriteOnly` only appears on
/// macOS 14+ / iOS 17+ when the app holds the partial-access entitlement.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalendarAuthorizationStatus {
    NotDetermined,
    Restricted,
    Denied,
    FullAccess,
    WriteOnly,
}

/// Mirror of `EKSourceType`. The names map 1:1 with the EventKit enum;
/// `MobileMe` is the legacy iCloud source value still emitted by some
/// older accounts.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalendarSourceType {
    Local,
    Exchange,
    #[serde(rename = "calDAV")]
    CalDav,
    MobileMe,
    Subscribed,
    Birthdays,
}

/// One row per EKSource — the top-level account containers shown as
/// section headers in macOS Calendar's sidebar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSource {
    pub id: String,
    pub title: String,
    pub source_type: CalendarSourceType,
}

/// One row per EKCalendar. `color_hex` is rendered into `#RRGGBB`
/// format for the webview so the existing Tailwind classes can use it
/// as inline style.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub source_id: String,
    pub title: String,
    pub color_hex: String,
    pub allows_modifications: bool,
}

/// One row per occurrence. Recurring events are pre-expanded by EventKit
/// inside `fetch_events`, so callers don't have to do RRULE math
/// themselves.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub event_identifier: String,
    /// Stable across devices — preferred key for our own metadata
    /// (notes/tags) so that an event on iCloud Mac and iCloud iPhone
    /// share the same identifier.
    pub external_identifier: Option<String>,
    pub calendar_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
    /// ISO 8601 with offset, e.g. "2026-04-27T10:00:00-04:00".
    pub starts_at: String,
    pub ends_at: String,
    pub is_all_day: bool,
    pub is_recurring: bool,
}

/// Inbound payload for `calendar_fetch_events`. Empty `calendar_ids`
/// means "every calendar the user has visible".
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchEventsRequest {
    pub starts_at: String,
    pub ends_at: String,
    #[serde(default)]
    pub calendar_ids: Vec<String>,
}

/// Inbound payload for `calendar_create_event`. The webview side
/// constructs ISO timestamps with offset already applied; this layer
/// only converts to NSDate (UTC underneath) for EventKit.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventRequest {
    pub calendar_id: String,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    #[serde(default)]
    pub is_all_day: bool,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
}
