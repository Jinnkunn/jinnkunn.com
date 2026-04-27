#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod calendar;

use keyring::Entry;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, COOKIE};
use reqwest::header::AUTHORIZATION;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

const KEYRING_SERVICE: &str = "com.jinnkunn.workspace.site-admin";
const BROWSER_LOGIN_TIMEOUT_SECONDS: u64 = 180;

#[derive(Debug, Deserialize)]
struct SiteAdminHttpRequest {
    base_url: String,
    path: String,
    method: String,
    body: Option<Value>,
    session_cookie: Option<String>,
    bearer_token: Option<String>,
    // Cloudflare Access service-token credentials. When both are set we
    // attach CF-Access-Client-Id + CF-Access-Client-Secret on every
    // request; CF validates these at the edge and injects a signed JWT
    // into the Worker's request headers.
    cf_access_client_id: Option<String>,
    cf_access_client_secret: Option<String>,
}

#[derive(Debug, Serialize)]
struct SiteAdminHttpResponse {
    ok: bool,
    status: u16,
    body: Value,
}

#[derive(Debug, Serialize)]
struct SiteAdminBrowserLoginResult {
    token: String,
    login: String,
    expires_at: String,
}

fn normalize_base_url(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.to_string()
}

fn normalize_path(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{}", trimmed)
    }
}

#[tauri::command]
async fn site_admin_http_request(
    request: SiteAdminHttpRequest,
) -> Result<SiteAdminHttpResponse, String> {
    let base_url = normalize_base_url(&request.base_url);
    if base_url.is_empty() {
        return Err("Missing base_url".to_string());
    }
    let path = normalize_path(&request.path);
    let method = request.method.trim().to_uppercase();
    if method.is_empty() {
        return Err("Missing method".to_string());
    }
    let url = format!("{}{}", base_url, path);

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(token) = request.bearer_token {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            let value = HeaderValue::from_str(&format!("Bearer {}", trimmed))
                .map_err(|_| "Invalid bearer token header".to_string())?;
            headers.insert(AUTHORIZATION, value);
        }
    }
    if let Some(cookie) = request.session_cookie {
        let trimmed = cookie.trim();
        if !trimmed.is_empty() {
            let value = HeaderValue::from_str(trimmed)
                .map_err(|_| "Invalid session cookie header".to_string())?;
            headers.insert(COOKIE, value);
        }
    }
    if let Some(cid) = request.cf_access_client_id {
        let trimmed = cid.trim();
        if !trimmed.is_empty() {
            let name = reqwest::header::HeaderName::from_static("cf-access-client-id");
            let value = HeaderValue::from_str(trimmed)
                .map_err(|_| "Invalid CF-Access-Client-Id header".to_string())?;
            headers.insert(name, value);
        }
    }
    if let Some(secret) = request.cf_access_client_secret {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            let name = reqwest::header::HeaderName::from_static("cf-access-client-secret");
            let value = HeaderValue::from_str(trimmed)
                .map_err(|_| "Invalid CF-Access-Client-Secret header".to_string())?;
            headers.insert(name, value);
        }
    }

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {}", e))?;

    let mut req = client.request(
        reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| format!("Unsupported method: {}", method))?,
        &url,
    );

    if method == "POST" || method == "PUT" || method == "PATCH" {
        req = req.json(&request.body.unwrap_or_else(|| json!({})));
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    // Read as bytes first so we can both try JSON *and* surface a useful
    // diagnostic when the response is HTML (e.g. a Cloudflare Access
    // intercept returning its login page).
    let raw_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    let body = match serde_json::from_slice::<Value>(&raw_bytes) {
        Ok(parsed) => parsed,
        Err(_) => {
            let snippet = String::from_utf8_lossy(&raw_bytes).chars().take(280).collect::<String>();
            json!({
                "ok": false,
                "code": "NON_JSON_RESPONSE",
                "error": format!(
                    "Non-JSON response (status={}, content-type={:?}). First 280 chars: {}",
                    status, content_type, snippet
                ),
                "status": status,
                "contentType": content_type,
                "snippet": snippet,
            })
        }
    };

    Ok(SiteAdminHttpResponse {
        ok: (200..300).contains(&status) && body.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
        status,
        body,
    })
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

#[tauri::command]
fn secure_store_set(key: String, value: String) -> Result<(), String> {
    let normalized_key = normalize_store_key(&key)?;
    let entry = Entry::new(KEYRING_SERVICE, &normalized_key)
        .map_err(|e| format!("Failed to initialize keyring entry: {}", e))?;
    entry
        .set_password(value.trim())
        .map_err(|e| format!("Failed to set secure credential: {}", e))
}

#[tauri::command]
fn secure_store_get(key: String) -> Result<Option<String>, String> {
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
fn secure_store_delete(key: String) -> Result<(), String> {
    let normalized_key = normalize_store_key(&key)?;
    let entry = Entry::new(KEYRING_SERVICE, &normalized_key)
        .map_err(|e| format!("Failed to initialize keyring entry: {}", e))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete secure credential: {}", e)),
    }
}

fn write_browser_callback_response(
    stream: &mut TcpStream,
    status: &str,
    title: &str,
    detail: &str,
) {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\" /><title>{}</title></head>\
        <body style=\"font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px;\">\
        <h2>{}</h2><p>{}</p><p>You can close this window.</p></body></html>",
        title, title, detail
    );
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn extract_query_value(url: &Url, key: &str) -> String {
    url.query_pairs()
        .find_map(|(k, v)| if k == key { Some(v.into_owned()) } else { None })
        .unwrap_or_default()
}

fn handle_browser_callback(
    mut stream: TcpStream,
    expected_state: &str,
) -> Result<SiteAdminBrowserLoginResult, String> {
    let mut buffer = [0_u8; 8192];
    let read = stream
        .read(&mut buffer)
        .map_err(|e| format!("Failed to read callback request: {}", e))?;
    if read == 0 {
        return Err("Empty callback request".to_string());
    }

    let raw = String::from_utf8_lossy(&buffer[..read]);
    let first_line = raw
        .lines()
        .next()
        .ok_or_else(|| "Missing callback request line".to_string())?;
    let target = first_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Missing callback request target".to_string())?;
    let callback_url = Url::parse(&format!("http://localhost{}", target))
        .map_err(|e| format!("Invalid callback URL: {}", e))?;

    let state = extract_query_value(&callback_url, "state");
    if state != expected_state {
        write_browser_callback_response(
            &mut stream,
            "400 Bad Request",
            "Authentication Failed",
            "State mismatch while finishing browser login.",
        );
        return Err("Browser login state mismatch".to_string());
    }

    let error = extract_query_value(&callback_url, "error");
    if !error.is_empty() {
        write_browser_callback_response(
            &mut stream,
            "400 Bad Request",
            "Authentication Failed",
            "The server returned an authentication error.",
        );
        return Err(format!("Server returned authentication error: {}", error));
    }

    let token = extract_query_value(&callback_url, "token");
    let login = extract_query_value(&callback_url, "login");
    let expires_at = extract_query_value(&callback_url, "expiresAt");
    if token.is_empty() || login.is_empty() || expires_at.is_empty() {
        write_browser_callback_response(
            &mut stream,
            "400 Bad Request",
            "Authentication Failed",
            "Missing token or user information in callback.",
        );
        return Err("Missing token, login, or expiry in callback response".to_string());
    }

    write_browser_callback_response(
        &mut stream,
        "200 OK",
        "Authentication Complete",
        "Desktop client authorization was completed successfully.",
    );
    Ok(SiteAdminBrowserLoginResult {
        token,
        login,
        expires_at,
    })
}

fn wait_for_browser_callback(
    listener: TcpListener,
    expected_state: String,
) -> Result<SiteAdminBrowserLoginResult, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to set nonblocking callback listener: {}", e))?;
    let deadline = Instant::now() + Duration::from_secs(BROWSER_LOGIN_TIMEOUT_SECONDS);

    loop {
        match listener.accept() {
            Ok((stream, _)) => return handle_browser_callback(stream, &expected_state),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("Browser login timed out".to_string());
                }
                thread::sleep(Duration::from_millis(150));
            }
            Err(err) => {
                return Err(format!("Failed waiting for callback: {}", err));
            }
        }
    }
}

fn random_state(length: usize) -> String {
    use rand::distributions::{Alphanumeric, DistString};
    Alphanumeric.sample_string(&mut rand::thread_rng(), length)
}

#[tauri::command]
async fn site_admin_browser_login(base_url: String) -> Result<SiteAdminBrowserLoginResult, String> {
    let normalized_base_url = normalize_base_url(&base_url);
    if normalized_base_url.is_empty() {
        return Err("Missing base_url".to_string());
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local callback port: {}", e))?;
    let callback_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read callback listener address: {}", e))?
        .port();

    let state = random_state(32);
    let redirect_uri = format!("http://127.0.0.1:{}/callback", callback_port);
    let mut authorize_url = Url::parse(&format!(
        "{}/api/site-admin/app-auth/authorize",
        normalized_base_url
    ))
    .map_err(|e| format!("Failed to build browser authorization URL: {}", e))?;
    authorize_url
        .query_pairs_mut()
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state);

    open::that(authorize_url.as_str())
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    let join = tauri::async_runtime::spawn_blocking(move || {
        wait_for_browser_callback(listener, state)
    });
    join.await
        .map_err(|e| format!("Failed to join browser callback task: {}", e))?
}

/// macOS traffic-lights inset (x, y) in window coordinates.
///
/// Ported from personal-os `src-tauri/src/lib.rs`: the (26, 28) values
/// place the lights centered inside a 52px sidebar header strip whose
/// top sits 8px below the window top. Keep these in sync with
/// `.sidebar__header { height }` in styles.css.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_INSET: (f32, f32) = (26.0, 28.0);

/// Dev-time knob for finding the perfect traffic-lights position without
/// rebuilding the Rust crate. Invoke from DevTools:
///
///   await window.__TAURI__.core.invoke(
///     "debug_set_traffic_lights",
///     { x: 26, y: 28 }
///   );
///
/// Once you find a value you like, update `TRAFFIC_LIGHTS_INSET` above so
/// it persists through resize/focus events (the re-apply branch uses the
/// const, not the last `set_traffic_lights_inset` call).
#[cfg(target_os = "macos")]
#[tauri::command]
fn debug_set_traffic_lights(window: tauri::WebviewWindow, x: f32, y: f32) -> Result<(), String> {
    use tauri_plugin_decorum::WebviewWindowExt;
    window
        .set_traffic_lights_inset(x, y)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn debug_set_traffic_lights(_x: f32, _y: f32) -> Result<(), String> {
    Ok(())
}

fn main() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_decorum::init())
        // Persist window position/size/maximized state across launches.
        // Writes to the OS app-data dir; no app code required.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Self-update plugin. Inert until tauri.conf.json's
        // `plugins.updater.pubkey` is filled with the public half of a
        // `tauri signer generate` keypair, and `endpoints` points at a
        // signed manifest. See .github/workflows/release.yml for the
        // build/publish pipeline.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            site_admin_http_request,
            secure_store_set,
            secure_store_get,
            secure_store_delete,
            site_admin_browser_login,
            debug_set_traffic_lights,
            calendar::commands::calendar_authorization_status,
            calendar::commands::calendar_request_access,
            calendar::commands::calendar_list_sources,
            calendar::commands::calendar_list_calendars,
            calendar::commands::calendar_fetch_events,
        ]);

    #[cfg(target_os = "macos")]
    {
        builder = builder.setup(|app| {
            use tauri::{Emitter, Manager};
            use tauri_plugin_decorum::WebviewWindowExt;
            use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

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

            // Bridge EventKit's change notification to a Tauri event.
            // Registered once for the app's lifetime; the calendar
            // surface listens for `calendar://changed` and refetches.
            let app_handle = app.app_handle().clone();
            calendar::eventkit::install_change_observer(move || {
                let _ = app_handle.emit("calendar://changed", ());
            });

            Ok(())
        });

        builder = builder.on_window_event(|window, event| {
            // Re-apply the traffic-lights inset after events that cause
            // macOS to reset the buttons to their system default. decorum's
            // set_traffic_lights_inset is one-shot — without this re-apply
            // the lights drift back to y=12 after the first resize.
            use tauri::Manager;
            use tauri_plugin_decorum::WebviewWindowExt;
            let should_reapply = matches!(
                event,
                tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::Focused(_)
                    | tauri::WindowEvent::ThemeChanged(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            );
            if should_reapply {
                if let Some(webview) = window.app_handle().get_webview_window("main") {
                    let (x, y) = TRAFFIC_LIGHTS_INSET;
                    let _ = webview.set_traffic_lights_inset(x, y);
                }
            }
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
