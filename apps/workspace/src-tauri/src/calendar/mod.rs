//! Calendar surface backend — bridges EventKit (macOS) to the webview.
//!
//! Layout:
//! - `types`     — serde types shared with the TS layer
//! - `eventkit`  — `unsafe` objc2 wrappers, macOS-only
//! - `commands`  — `#[tauri::command]` entry points wired into
//!                 `invoke_handler` from `main.rs`
//!
//! Re-exporting only the commands keeps `main.rs` from depending on
//! the `objc2` types directly.

pub mod commands;
#[cfg(target_os = "macos")]
pub mod eventkit;
mod types;
