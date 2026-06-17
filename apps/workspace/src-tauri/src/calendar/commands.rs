//! Tauri commands that bridge the webview to the EventKit wrappers.
//! Each command is a thin shell around `eventkit::*`; on non-macOS
//! targets they all return a "platform not supported" error so the
//! frontend can degrade gracefully without a `#[cfg]` of its own.

use crate::calendar::types::{
    Calendar, CalendarAuthorizationStatus, CalendarEvent, CalendarSource, CreateEventRequest,
    FetchEventsRequest,
};
#[cfg(all(target_os = "macos", debug_assertions))]
use std::io::Write;

#[cfg(target_os = "macos")]
use crate::calendar::eventkit;

#[cfg(not(target_os = "macos"))]
const UNSUPPORTED: &str = "Calendar is only available on macOS in this build";

#[cfg(all(target_os = "macos", debug_assertions))]
fn debug_log(message: impl AsRef<str>) {
    let message = message.as_ref();
    eprintln!("{message}");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open("/tmp/jinnkunn-calendar-debug.log")
    {
        let _ = writeln!(file, "{message}");
    }
}

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn debug_log(_message: impl AsRef<str>) {}

#[tauri::command]
pub fn calendar_authorization_status() -> Result<CalendarAuthorizationStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let status = eventkit::authorization_status();
        debug_log(format!("[calendar] authorization_status -> {status:?}"));
        Ok(status)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
pub async fn calendar_request_access() -> Result<CalendarAuthorizationStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let status = eventkit::request_access().await;
        debug_log(format!("[calendar] request_access -> {status:?}"));
        status
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
pub fn calendar_list_sources() -> Result<Vec<CalendarSource>, String> {
    #[cfg(target_os = "macos")]
    {
        let sources = eventkit::list_sources();
        match &sources {
            Ok(rows) => debug_log(format!("[calendar] list_sources -> {} rows", rows.len())),
            Err(error) => debug_log(format!("[calendar] list_sources -> error: {error}")),
        }
        sources
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
pub fn calendar_list_calendars(source_id: Option<String>) -> Result<Vec<Calendar>, String> {
    #[cfg(target_os = "macos")]
    {
        let calendars = eventkit::list_calendars(source_id.as_deref());
        match &calendars {
            Ok(rows) => debug_log(format!("[calendar] list_calendars -> {} rows", rows.len())),
            Err(error) => debug_log(format!("[calendar] list_calendars -> error: {error}")),
        }
        calendars
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = source_id;
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
pub fn calendar_fetch_events(request: FetchEventsRequest) -> Result<Vec<CalendarEvent>, String> {
    #[cfg(target_os = "macos")]
    {
        let events = eventkit::fetch_events(&request);
        match &events {
            Ok(rows) => debug_log(format!("[calendar] fetch_events -> {} rows", rows.len())),
            Err(error) => debug_log(format!("[calendar] fetch_events -> error: {error}")),
        }
        events
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
pub fn calendar_create_event(request: CreateEventRequest) -> Result<CalendarEvent, String> {
    #[cfg(target_os = "macos")]
    {
        eventkit::create_event(&request)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        Err(UNSUPPORTED.to_string())
    }
}
