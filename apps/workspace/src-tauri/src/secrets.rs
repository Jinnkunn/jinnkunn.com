//! Credential storage bridge for the webview.
//!
//! Stored keys today:
//! - `site-admin:token::<base-url>` — browser-login app token
//! - `site-admin:cf-access-id::<base-url>` — Cloudflare Access client id
//! - `site-admin:cf-access-secret::<base-url>` — Cloudflare Access secret
//!
//! Production defaults to the OS keychain. Debug builds default to the
//! local `workspace.db.secure_values` table so macOS does not interrupt
//! development/testing with repeated Keychain permission prompts.
//!
//! Runtime override:
//! - `WORKSPACE_SECRET_BACKEND=keychain`
//! - `WORKSPACE_SECRET_BACKEND=local-db`

use crate::local_db;
use keyring::Entry;
use rusqlite::{params, Connection, OptionalExtension};

pub const KEYRING_SERVICE: &str = "com.jinnkunn.workspace.site-admin";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SecretBackend {
    Keychain,
    LocalDb,
}

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

fn selected_backend() -> SecretBackend {
    match std::env::var("WORKSPACE_SECRET_BACKEND")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "keychain" => SecretBackend::Keychain,
        "local-db" | "local_db" | "sqlite" | "db" => SecretBackend::LocalDb,
        _ if cfg!(debug_assertions) => SecretBackend::LocalDb,
        _ => SecretBackend::Keychain,
    }
}

fn local_store_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO secure_values (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value.trim(), chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|err| format!("Failed to write local credential: {err}"))?;
    Ok(())
}

fn local_store_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM secure_values WHERE key = ?",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|err| format!("Failed to read local credential: {err}"))
}

fn local_store_delete(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM secure_values WHERE key = ?", params![key])
        .map_err(|err| format!("Failed to delete local credential: {err}"))?;
    Ok(())
}

fn keychain_store_set(key: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, key)
        .map_err(|e| format!("Failed to initialize keyring entry: {}", e))?;
    entry
        .set_password(value.trim())
        .map_err(|e| format!("Failed to set secure credential: {}", e))
}

fn keychain_store_get(key: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(KEYRING_SERVICE, key)
        .map_err(|e| format!("Failed to initialize keyring entry: {}", e))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read secure credential: {}", e)),
    }
}

fn keychain_store_delete(key: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, key)
        .map_err(|e| format!("Failed to initialize keyring entry: {}", e))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete secure credential: {}", e)),
    }
}

#[tauri::command]
pub fn secure_store_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let normalized_key = normalize_store_key(&key)?;
    match selected_backend() {
        SecretBackend::Keychain => keychain_store_set(&normalized_key, &value),
        SecretBackend::LocalDb => {
            let conn = local_db::open(&app)?;
            local_store_set(&conn, &normalized_key, &value)
        }
    }
}

#[tauri::command]
pub fn secure_store_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let normalized_key = normalize_store_key(&key)?;
    match selected_backend() {
        SecretBackend::Keychain => keychain_store_get(&normalized_key),
        SecretBackend::LocalDb => {
            let conn = local_db::open(&app)?;
            local_store_get(&conn, &normalized_key)
        }
    }
}

#[tauri::command]
pub fn secure_store_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let normalized_key = normalize_store_key(&key)?;
    match selected_backend() {
        SecretBackend::Keychain => keychain_store_delete(&normalized_key),
        SecretBackend::LocalDb => {
            let conn = local_db::open(&app)?;
            local_store_delete(&conn, &normalized_key)
        }
    }
}

#[tauri::command]
pub fn secure_store_backend() -> Result<String, String> {
    Ok(match selected_backend() {
        SecretBackend::Keychain => "keychain",
        SecretBackend::LocalDb => "local-db",
    }
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_store_round_trips_and_deletes_credentials() {
        let conn = Connection::open_in_memory().expect("open sqlite");
        local_db::run_migrations(&conn).expect("migrate");

        local_store_set(&conn, "site-admin:token::local", " token ").expect("set");
        assert_eq!(
            local_store_get(&conn, "site-admin:token::local").expect("get"),
            Some("token".to_string())
        );

        local_store_delete(&conn, "site-admin:token::local").expect("delete");
        assert_eq!(
            local_store_get(&conn, "site-admin:token::local").expect("get after delete"),
            None
        );
    }

    #[test]
    fn store_keys_are_normalized_and_bounded() {
        assert_eq!(normalize_store_key(" token ").unwrap(), "token");
        assert!(normalize_store_key("").is_err());
        assert!(normalize_store_key(&"x".repeat(241)).is_err());
    }
}
