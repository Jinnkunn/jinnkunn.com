//! Tauri commands that bridge the webview to the EventKit wrappers.
//! Each command is a thin shell around `eventkit::*`; on non-macOS
//! targets they all return a "platform not supported" error so the
//! frontend can degrade gracefully without a `#[cfg]` of its own.

use crate::calendar::types::{
    Calendar, CalendarAuthorizationStatus, CalendarEvent, CalendarSource, FetchEventsRequest,
};

#[cfg(target_os = "macos")]
use crate::calendar::eventkit;

#[cfg(not(target_os = "macos"))]
const UNSUPPORTED: &str = "Calendar is only available on macOS in this build";

#[tauri::command]
pub fn calendar_authorization_status() -> Result<CalendarAuthorizationStatus, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(eventkit::authorization_status())
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
        eventkit::request_access().await
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
        eventkit::list_sources()
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
        eventkit::list_calendars(source_id.as_deref())
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
        eventkit::fetch_events(&request)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        Err(UNSUPPORTED.to_string())
    }
}
