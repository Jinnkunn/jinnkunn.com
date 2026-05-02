//! Workspace shell — Tauri builder + invoke_handler registration.
//!
//! Surface logic lives in per-domain modules:
//! - `calendar` (EventKit + publish rules)
//! - `local_calendar`, `notes`, `todos`, `contacts` — local-first surfaces
//! - `sync`, `outbox` — D1 mirror + offline write queue
//!
//! Shell concerns split out for readability:
//! - `site_admin` — HTTP proxy + browser-based OAuth login
//! - `secrets`    — OS keychain wrappers
//! - `desktop_shell` — tray, menubar, hotkey, traffic-lights, vibrancy

mod calendar;
mod contacts;
mod desktop_shell;
mod local_calendar;
mod local_db;
mod notes;
mod outbox;
mod projects;
mod secrets;
mod site_admin;
mod sync;
mod todos;

#[cfg_attr(
    any(target_os = "ios", target_os = "android"),
    tauri::mobile_entry_point
)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Custom URI scheme so the BlocksEditor can render `note-asset://`
        // URLs that point at the local notes-assets dir. The `notes_save_asset`
        // command writes files there; this handler reads them back. Path
        // validation lives in `notes::resolve_asset_path` to keep the
        // traversal-prevention rules co-located with the writer.
        .register_uri_scheme_protocol("note-asset", |ctx, request| {
            let app = ctx.app_handle();
            let raw_path = request.uri().path();
            let name = raw_path.trim_start_matches('/');
            let Some(file_path) = notes::resolve_asset_path(app, name) else {
                return tauri::http::Response::builder()
                    .status(404)
                    .body(b"not found".to_vec())
                    .unwrap_or_else(|_| tauri::http::Response::new(b"error".to_vec()));
            };
            match std::fs::read(&file_path) {
                Ok(bytes) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", notes::asset_content_type(&file_path))
                    .header("Cache-Control", "public, max-age=31536000, immutable")
                    .body(bytes)
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
                Err(_) => tauri::http::Response::builder()
                    .status(500)
                    .body(b"read error".to_vec())
                    .unwrap_or_else(|_| tauri::http::Response::new(b"error".to_vec())),
            }
        });

    let builder = desktop_shell::install_desktop_shell_plugins(builder)
        // Native OS notifications. Used by the JS side to fire
        // "Production deploy started / complete / failed" toasts so the
        // operator can step away from the app during a 5-10 min release.
        .plugin(tauri_plugin_notification::init())
        // Native AppKit alert / confirm sheets, used by the auto-updater
        // prompt (see lib/updater.ts) so the "update available" dialog
        // is a real macOS window-level alert instead of the webview's
        // blandly cross-platform `window.confirm()`.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            site_admin::site_admin_http_request,
            site_admin::site_admin_browser_login,
            secrets::secure_store_set,
            secrets::secure_store_get,
            secrets::secure_store_delete,
            calendar::publish_rules::calendar_publish_rules_load,
            calendar::publish_rules::calendar_publish_rules_save,
            desktop_shell::debug_set_traffic_lights,
            desktop_shell::open_external_url,
            desktop_shell::show_context_menu,
            calendar::commands::calendar_authorization_status,
            calendar::commands::calendar_request_access,
            calendar::commands::calendar_list_sources,
            calendar::commands::calendar_list_calendars,
            calendar::commands::calendar_fetch_events,
            calendar::commands::calendar_create_event,
            local_calendar::local_calendar_list_calendars,
            local_calendar::local_calendar_create_calendar,
            local_calendar::local_calendar_update_calendar,
            local_calendar::local_calendar_archive_calendar,
            local_calendar::local_calendar_fetch_events,
            local_calendar::local_calendar_create_event,
            local_calendar::local_calendar_update_event,
            local_calendar::local_calendar_archive_event,
            local_calendar::local_calendar_unarchive_event,
            notes::notes_list,
            notes::notes_list_archived,
            notes::notes_get,
            notes::notes_create,
            notes::notes_update,
            notes::notes_move,
            notes::notes_archive,
            notes::notes_unarchive,
            notes::notes_search,
            notes::notes_save_asset,
            projects::projects_list,
            projects::projects_get,
            projects::projects_create,
            projects::projects_update,
            projects::projects_archive,
            projects::projects_unarchive,
            projects::projects_move,
            projects::project_links_list,
            projects::project_links_create,
            projects::project_links_delete,
            todos::todos_list,
            todos::todos_list_by_project,
            todos::todos_list_by_note_source,
            todos::todos_list_window,
            todos::todos_create,
            todos::todos_update,
            todos::todos_archive,
            todos::todos_clear_completed,
            contacts::contacts_list,
            contacts::contacts_list_archived,
            contacts::contacts_get,
            contacts::contacts_create,
            contacts::contacts_update,
            contacts::contacts_archive,
            contacts::contacts_unarchive,
            contacts::contacts_search,
            contacts::contacts_upcoming_birthdays,
            contacts::contact_interactions_list,
            contacts::contact_interactions_create,
            contacts::contact_interactions_update,
            contacts::contact_interactions_delete,
            contacts::contacts_derive_calendar_interactions,
            contacts::contacts_list_backlinks,
            // Phase 5a — local SQLite mirror of D1 content_files. Sync
            // pulls the delta on demand; the read commands serve the
            // editor without a network round-trip.
            sync::sync_pull,
            sync::local_get_file,
            sync::local_list_files,
            sync::local_sync_status,
            // Phase 5b — write outbox. Mutating site-admin requests
            // that fail with a network error get queued here so a
            // brief offline window doesn't lose work; outbox_drain
            // replays them when the network comes back.
            outbox::outbox_enqueue,
            outbox::outbox_status,
            outbox::outbox_list,
            outbox::outbox_remove,
            outbox::outbox_drain,
        ]);

    let builder = desktop_shell::install_menu_event_handler(builder)
        .setup(|app| {
            // Tray + menubar background-mode lives at the cross-platform
            // level so a future Linux/Windows build picks it up too.
            desktop_shell::install_tray(app)?;

            desktop_shell::register_global_hotkey(app);

            #[cfg(target_os = "macos")]
            {
                use tauri::{Emitter, Manager};

                desktop_shell::apply_macos_window_chrome(app);

                // Bridge EventKit's change notification to a Tauri event.
                // Registered once for the app's lifetime; the calendar
                // surface listens for `calendar://changed` and refetches.
                let app_handle = app.app_handle().clone();
                calendar::eventkit::install_change_observer(move || {
                    let _ = app_handle.emit("calendar://changed", ());
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::WindowEvent;

            // Hide-on-close: keep the app running in the menubar instead
            // of tearing down state when the user clicks the red traffic
            // light or hits Cmd+W. The tray menu's "Quit" + the system
            // Cmd+Q route stay as the only ways to actually exit.
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                return;
            }

            #[cfg(target_os = "macos")]
            desktop_shell::reapply_traffic_lights_on_window_event(window, event);
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    desktop_shell::run_tauri_app(app);
}
