//! OS keychain wrapper. The webview reads/writes credentials (mostly
//! the site-admin bearer token) through these commands so they live in
//! the macOS Keychain via `keyring`'s `apple-native` backend, instead
//! of localStorage where any extension or stale tab could read them.
//!
//! Keys are namespaced under `KEYRING_SERVICE`. A future MCP server in
//! the same binary can read the bearer back from here without
//! involving the webview.

use keyring::Entry;

pub const KEYRING_SERVICE: &str = "com.jinnkunn.workspace.site-admin";

fn normalize_store_key(input: &str) -> Result<String, String> {
    let key = input.trim();
    if key.is_empty() {
        return Err("Missing secure store key".to_string());
    }
    if key.len() > 240 {
        return Err("Secure store key too long".to_string());
    }
    Ok(key.to_string())
}

#[tauri::command]
pub fn secure_store_set(key: String, value: String) -> Result<(), String> {
    let normalized_key = normalize_store_key(&key)?;
    let entry = Entry::new(KEYRING_SERVICE, &normalized_key)
        .map_err(|e| format!("Failed to initialize keyring entry: {}", e))?;
    entry
        .set_password(value.trim())
        .map_err(|e| format!("Failed to set secure credential: {}", e))
}

#[tauri::command]
pub fn secure_store_get(key: String) -> Result<Option<String>, String> {
    let normalized_key = normalize_store_key(&key)?;
    let entry = Entry::new(KEYRING_SERVICE, &normalized_key)
        .map_err(|e| format!("Failed to initialize keyring entry: {}", e))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read secure credential: {}", e)),
    }
}

#[tauri::command]
pub fn secure_store_delete(key: String) -> Result<(), String> {
    let normalized_key = normalize_store_key(&key)?;
    let entry = Entry::new(KEYRING_SERVICE, &normalized_key)
        .map_err(|e| format!("Failed to initialize keyring entry: {}", e))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete secure credential: {}", e)),
    }
}
