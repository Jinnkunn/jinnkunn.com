//! Calendar surface backend — bridges EventKit (macOS) to the webview.
//!
//! Layout:
//! - `types`           — serde types shared with the TS layer
//! - `eventkit`        — `unsafe` objc2 wrappers, macOS-only
//! - `commands`        — `#[tauri::command]` entry points for EventKit
//! - `publish_rules`   — per-event publish overrides stored in the local
//!   SQLite mirror, cross-platform
//!
//! Re-exporting only the commands keeps `lib.rs` from depending on
//! the `objc2` types directly.

pub mod commands;
#[cfg(target_os = "macos")]
pub mod eventkit;
pub mod publish_rules;
pub mod types;
