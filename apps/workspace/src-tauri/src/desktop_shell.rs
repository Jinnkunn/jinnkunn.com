//! Native desktop chrome: menubar, tray, hotkey, traffic-lights inset,
//! vibrancy, dock-reopen handling, and the AppKit context-menu / open-URL
//! helpers the webview uses.
//!
//! The webview-facing `#[tauri::command]` functions in this module
//! (`open_external_url`, `show_context_menu`, `debug_set_traffic_lights`)
//! are registered into Tauri's invoke_handler from `lib.rs::run`.
//! The setup helpers (`install_tray`, `install_desktop_shell_plugins`,
//! `install_menu_event_handler`, `run_tauri_app`, `apply_macos_window_chrome`,
//! `register_global_hotkey`) are called from `lib.rs::run` during
//! the builder construction phase.

use serde::Deserialize;
use url::Url;

/// macOS traffic-lights inset (x, y) in window coordinates.
///
/// The values place the lights inside the independent 42px workspace
/// titlebar. Keep this aligned with `--workspace-titlebar-height` so
/// the traffic lights read as part of the titlebar, not the sidebar.
#[cfg(target_os = "macos")]
pub const TRAFFIC_LIGHTS_INSET: (f32, f32) = (12.0, 16.0);

/// Dev-time knob for finding the perfect traffic-lights position without
/// rebuilding the Rust crate. Invoke from DevTools:
///
///   await window.__TAURI__.core.invoke(
///     "debug_set_traffic_lights",
///     { x: 12, y: 16 }
///   );
///
/// Once you find a value you like, update `TRAFFIC_LIGHTS_INSET` above so
/// it persists through resize/focus events (the re-apply branch uses the
/// const, not the last `set_traffic_lights_inset` call).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn debug_set_traffic_lights(
    window: tauri::WebviewWindow,
    x: f32,
    y: f32,
) -> Result<(), String> {
    use tauri_plugin_decorum::WebviewWindowExt;
    window
        .set_traffic_lights_inset(x, y)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn debug_set_traffic_lights(_x: f32, _y: f32) -> Result<(), String> {
    Ok(())
}

/// Open a URL in the user's default browser. The webview can't honor
/// `<a target="_blank">` on its own — `target=_blank` either no-ops or
/// tries to load inside the webview, depending on platform — so we
/// route every "open in browser" affordance (Promote-to-Production
/// dispatched-run link, the Publish panel's Deploy Action link, and
/// any future external link button) through this command. Same `open`
/// crate the browser-login flow already uses, so no new dependency.
///
/// Validates the input is a real http/https URL before calling
/// `open::that`. Refusing arbitrary strings keeps a malicious payload
/// from ever reaching the OS shell — this command is invoked from the
/// webview, which is rendering content the operator authored, but
/// defense-in-depth is cheap.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("empty url".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|err| format!("invalid url: {err}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("unsupported url scheme: {scheme}"));
    }
    open::that(parsed.as_str()).map_err(|err| err.to_string())
}

/// Open the OS-owned Calendar account manager. EventKit account add/remove
/// flows belong to macOS; Workspace can refresh and filter calendars but
/// should not pretend to delete iCloud/Google accounts itself.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_calendar_account_settings() -> Result<(), String> {
    open::that("x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension")
        .or_else(|_| open::that("x-apple.systempreferences:com.apple.preferences.internetaccounts"))
        .or_else(|_| open::that("x-apple.systempreferences:"))
        .map_err(|err| err.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn open_calendar_account_settings() -> Result<(), String> {
    Err("Calendar accounts are managed by the operating system.".to_string())
}

/// Bring the main webview back into view from the menubar tray or a
/// dock-click after the user closed the window. Hidden windows survive
/// "close" because our `CloseRequested` handler swallows the close
/// instead of destroying the surface, so `show + unminimize + focus`
/// is enough to restore them — no state rebuild required.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(any(target_os = "ios", target_os = "android"))]
pub fn show_main_window(_app: &tauri::AppHandle) {}

/// Toggle the main window's visibility from the tray icon's primary
/// click. Falls back to "show" when the visibility query errors,
/// because a stuck-hidden window is worse UX than a no-op show.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn toggle_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

#[cfg(any(target_os = "ios", target_os = "android"))]
pub fn toggle_main_window(_app: &tauri::AppHandle) {}

#[derive(Debug, Deserialize)]
pub struct ContextMenuItem {
    /// Stable id — emitted on `menu://action` when the user picks this
    /// item. Must be globally unique within a single popup. Convention
    /// is `ctx:<surface>:<action>` so the JS-side router can pattern-
    /// match without colliding with the menubar `menu-*` ids.
    id: String,
    label: String,
    /// Disabled items still render but can't be activated. Useful for
    /// "Open in browser" when the row has no public URL yet.
    enabled: Option<bool>,
}

/// Show a native AppKit popup at the cursor for right-click /
/// long-press surfaces. Items are passed in from the webview; selection
/// flows back through the same `menu://action` channel as the menubar
/// (see `install_menu_event_handler`), so the JS side has one listener
/// for both pathways. The command is fire-and-forget — the popup is
/// modal-ish from the user's perspective but `popup` returns
/// immediately, and dismissal without a selection is a no-op.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
pub async fn show_context_menu(
    app: tauri::AppHandle,
    window: tauri::Window,
    items: Vec<ContextMenuItem>,
) -> Result<(), String> {
    use tauri::menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem};

    if items.is_empty() {
        return Ok(());
    }

    let mut entries: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> =
        Vec::with_capacity(items.len());
    let mut sep_holder: Vec<PredefinedMenuItem<tauri::Wry>> = Vec::new();
    let mut item_holder: Vec<MenuItem<tauri::Wry>> = Vec::new();

    for item in &items {
        if item.id == "-" || item.label == "-" {
            let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
            sep_holder.push(sep);
        } else {
            let m = MenuItem::with_id(
                &app,
                &item.id,
                &item.label,
                item.enabled.unwrap_or(true),
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            item_holder.push(m);
        }
    }

    // Re-walk in original order, picking from each holder. Holders keep
    // the `MenuItem` values alive for the lifetime of `entries` —
    // necessary because `IsMenuItem` is a borrow.
    let mut sep_idx = 0;
    let mut item_idx = 0;
    for item in &items {
        if item.id == "-" || item.label == "-" {
            entries.push(Box::new(sep_holder[sep_idx].clone()));
            sep_idx += 1;
        } else {
            entries.push(Box::new(item_holder[item_idx].clone()));
            item_idx += 1;
        }
    }

    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        entries.iter().map(|b| b.as_ref()).collect();
    let menu = Menu::with_items(&app, &refs).map_err(|e| e.to_string())?;
    menu.popup(window).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(any(target_os = "ios", target_os = "android"))]
#[tauri::command]
pub async fn show_context_menu(
    _app: tauri::AppHandle,
    _window: tauri::Window,
    _items: Vec<ContextMenuItem>,
) -> Result<(), String> {
    Ok(())
}

/// Build the menubar tray icon + its right-click menu.
///
/// The tray is registered once at startup. We keep the bundled app
/// icon as the tray glyph and let macOS template-strip it (so the
/// menubar shows a tinted silhouette instead of the colorful brand
/// mark). On non-macOS targets `icon_as_template` is a no-op.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn install_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let show = MenuItem::with_id(app, "tray-show", "Open Workspace", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "tray-quit",
        "Quit Jinnkunn Workspace",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;

    // Bundled at compile time — `include_image!` resolves the path at
    // build time and embeds the PNG bytes into the binary, so the tray
    // works the same in `tauri dev` and a packaged .app without
    // worrying about resource copy semantics. The PNG is the brand
    // mark in pure black on transparent (regenerated from tray.svg via
    // apps/workspace/scripts/build-tray-icon.mjs); macOS template-tints
    // it for light/dark menubar at runtime.
    // `include_image!` resolves paths relative to CARGO_MANIFEST_DIR
    // (i.e. src-tauri/), not the source file — so this is `icons/...`
    // even though we're in `src/`.
    let icon = tauri::include_image!("icons/tray.png");

    let _tray = TrayIconBuilder::with_id("jinnkunn-workspace-tray")
        .tooltip("Jinnkunn Workspace")
        .icon(icon)
        // macOS expects a template (single-channel) icon for the menubar.
        // Our PNG is already pre-templated (black + alpha), and this flag
        // tells AppKit to render it with the system foreground color
        // (light/dark adaptive). No-op on Linux / Windows.
        .icon_as_template(true)
        // Don't open the menu on left-click — left-click toggles the
        // window, right-click opens the menu (standard menubar UX).
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-show" => show_main_window(app),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(any(target_os = "ios", target_os = "android"))]
pub fn install_tray(_app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn install_desktop_shell_plugins(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
}

#[cfg(any(target_os = "ios", target_os = "android"))]
pub fn install_desktop_shell_plugins(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn install_menu_event_handler(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder.on_menu_event(|app, event| {
        // Route every menubar selection. A handful of items are
        // handled in Rust (reload, external URLs); the rest are
        // forwarded to the frontend as a `menu://action` event so
        // React can dispatch into the same handlers the palette
        // uses. Keeping the routing list short means new commands
        // only need a `MenuItem::with_id` line above + a JS
        // listener — no Rust round-trip.
        use tauri::{Emitter, Manager};
        let id = event.id.as_ref();
        match id {
            "menu-reload" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.location.reload();");
                }
            }
            "menu-help-runbook" => {
                let _ = open::that(
                    "https://github.com/jinnkunn/jinnkunn.com/blob/main/docs/production-runbook.md",
                );
            }
            "menu-help-actions" => {
                let _ = open::that("https://github.com/jinnkunn/jinnkunn.com/actions");
            }
            _ => {
                // Forward to JS. Payload is the menu id verbatim so
                // the frontend can pattern-match without parsing.
                let _ = app.emit("menu://action", id);
            }
        }
    })
}

#[cfg(any(target_os = "ios", target_os = "android"))]
pub fn install_menu_event_handler(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder
}

/// Native AppKit menubar — File / Edit / View / Calendar / Window /
/// Help. Replaces Tauri's default empty menubar so the app gets the
/// AppKit-standard menus the operator expects (Cmd+Q, Cmd+W,
/// services, hide-others) plus our own shortcuts. Each `MenuItem` ID
/// is routed in `install_menu_event_handler` either to a Rust handler
/// (window management) or to a JS-side custom event so the frontend
/// can react (palette commands, theme cycle, view changes).
///
/// On non-macOS targets the menubar is per-window rather than global;
/// the same ID layout still works there once we test on Linux/Win.
#[cfg(target_os = "macos")]
pub fn build_menubar(
    app: &tauri::AppHandle,
) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};

    // Helper: build a menu item with an accelerator string. Tauri 2
    // uses the same `CmdOrCtrl+Shift+N` syntax as Electron, which on
    // macOS resolves to ⌘ ⇧ N automatically.
    fn item(
        app: &tauri::AppHandle,
        id: &str,
        label: &str,
        accelerator: Option<&str>,
    ) -> Result<MenuItem<tauri::Wry>, Box<dyn std::error::Error>> {
        Ok(MenuItem::with_id(app, id, label, true, accelerator)?)
    }

    let about_meta = AboutMetadataBuilder::new()
        .name(Some("Jinnkunn Workspace"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .website(Some("https://jinkunchen.com"))
        .build();

    let app_menu = Submenu::with_items(
        app,
        "Jinnkunn Workspace",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Jinnkunn Workspace"), Some(about_meta))?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "menu-check-updates", "Check for Updates…", None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item(app, "menu-new-event", "New Event", Some("CmdOrCtrl+N"))?,
            &item(app, "menu-new-post", "New Post", Some("CmdOrCtrl+Shift+P"))?,
            &item(app, "menu-new-page", "New Page", Some("CmdOrCtrl+Shift+G"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(
                app,
                "menu-open-palette",
                "Command Palette…",
                Some("CmdOrCtrl+K"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "menu-find", "Find…", Some("CmdOrCtrl+F"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item(
                app,
                "menu-cycle-theme",
                "Cycle Theme",
                Some("CmdOrCtrl+Shift+T"),
            )?,
            &item(app, "menu-reload", "Reload", Some("CmdOrCtrl+R"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let calendar_menu = Submenu::with_items(
        app,
        "Calendar",
        true,
        &[
            &item(app, "menu-cal-today", "Today", Some("CmdOrCtrl+T"))?,
            &item(app, "menu-cal-prev", "Previous", Some("CmdOrCtrl+["))?,
            &item(app, "menu-cal-next", "Next", Some("CmdOrCtrl+]"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "menu-cal-day", "Day View", Some("CmdOrCtrl+1"))?,
            &item(app, "menu-cal-week", "Week View", Some("CmdOrCtrl+2"))?,
            &item(app, "menu-cal-month", "Month View", Some("CmdOrCtrl+3"))?,
            &item(app, "menu-cal-agenda", "Agenda View", Some("CmdOrCtrl+4"))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &item(app, "menu-help-runbook", "Open Production Runbook", None)?,
            &item(app, "menu-help-actions", "Open GitHub Actions", None)?,
        ],
    )?;

    Ok(Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &calendar_menu,
            &window_menu,
            &help_menu,
        ],
    )?)
}

/// Register Cmd+Shift+J (macOS) / Ctrl+Shift+J (else) to bring the
/// window forward from anywhere. The combo avoids common single-app
/// shortcuts (Cmd+Space = Spotlight, Cmd+Tab = app switcher, Cmd+Shift+K
/// = Linear new task, etc.) and is unlikely to clash with other apps
/// the operator runs. Failures here are logged but non-fatal — the app
/// still works without the global shortcut, just requires a tray-icon
/// click to summon.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn register_global_hotkey(app: &tauri::App) {
    use tauri::Manager;
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };
    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
    let shortcut = Shortcut::new(Some(modifiers), Code::KeyJ);
    let app_handle = app.app_handle().clone();
    if let Err(err) = app
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _hotkey, event| {
            // Tauri 2 fires on both Pressed and Released —
            // act on Pressed only so Cmd+Shift+J doesn't
            // toggle the window twice per keystroke.
            if event.state() != ShortcutState::Pressed {
                return;
            }
            toggle_main_window(&app_handle);
        })
    {
        eprintln!("[setup] failed to register global shortcut Cmd+Shift+J: {err}");
    }
}

#[cfg(any(target_os = "ios", target_os = "android"))]
pub fn register_global_hotkey(_app: &tauri::App) {}

/// Apply the macOS-only window chrome: native menubar, overlay titlebar,
/// inset traffic lights, vibrancy. Non-fatal on individual failures —
/// each step logs and continues, so a regression in one piece doesn't
/// break the rest of the window.
#[cfg(target_os = "macos")]
pub fn apply_macos_window_chrome(app: &tauri::App) {
    use tauri::Manager;
    use tauri_plugin_decorum::WebviewWindowExt;
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

    // Native AppKit menubar. Failure here is non-fatal — the
    // window still works without our custom menu, falling
    // back to Tauri's empty default. Logged so we notice in
    // dev if the menu builder breaks.
    match build_menubar(app.app_handle()) {
        Ok(menu) => {
            if let Err(err) = app.set_menu(menu) {
                eprintln!("[setup] failed to attach menubar: {err}");
            }
        }
        Err(err) => {
            eprintln!("[setup] failed to build menubar: {err}");
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        // Order ported from personal-os: overlay titlebar first
        // (so decorum hooks into the window chrome), then inset
        // the traffic lights, then apply vibrancy.
        if let Err(err) = window.create_overlay_titlebar() {
            eprintln!("[setup] failed to create overlay titlebar: {err}");
        }
        let (tlx, tly) = TRAFFIC_LIGHTS_INSET;
        if let Err(err) = window.set_traffic_lights_inset(tlx, tly) {
            eprintln!("[setup] failed to set traffic light inset: {err}");
        }
        // `WindowBackground` is personal-os's choice — semantically
        // correct for a primary application window (same material
        // Notion / Linear / native macOS apps use). `Sidebar` and
        // `HudWindow` tint noticeably more and don't match.
        let _ = apply_vibrancy(
            &window,
            NSVisualEffectMaterial::WindowBackground,
            None,
            None,
        );
    }
}

#[cfg(not(target_os = "macos"))]
pub fn apply_macos_window_chrome(_app: &tauri::App) {}

/// Re-apply the traffic-lights inset after events that cause macOS to
/// reset the buttons to their system default. decorum's
/// `set_traffic_lights_inset` is one-shot — without this re-apply the
/// lights drift back to y=12 after the first resize.
#[cfg(target_os = "macos")]
pub fn reapply_traffic_lights_on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    use tauri::{Manager, WindowEvent};
    use tauri_plugin_decorum::WebviewWindowExt;
    let should_reapply = matches!(
        event,
        WindowEvent::Resized(_)
            | WindowEvent::Focused(_)
            | WindowEvent::ThemeChanged(_)
            | WindowEvent::ScaleFactorChanged { .. }
    );
    if should_reapply {
        if let Some(webview) = window.app_handle().get_webview_window("main") {
            let (x, y) = TRAFFIC_LIGHTS_INSET;
            let _ = webview.set_traffic_lights_inset(x, y);
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn reapply_traffic_lights_on_window_event(
    _window: &tauri::Window,
    _event: &tauri::WindowEvent,
) {
}

/// Run the Tauri app loop. Intercepts macOS's "reopen" (clicking the
/// dock icon while no window is visible) and brings the main window
/// back instead of leaving the user staring at nothing.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn run_tauri_app(app: tauri::App<tauri::Wry>) {
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                show_main_window(app_handle);
            }
        }
    });
}

#[cfg(any(target_os = "ios", target_os = "android"))]
pub fn run_tauri_app(app: tauri::App<tauri::Wry>) {
    app.run(|_app_handle, _event| {});
}
