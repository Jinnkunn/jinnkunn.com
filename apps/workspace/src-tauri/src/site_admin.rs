//! Site-admin transport: HTTP proxy + browser-based OAuth login.
//!
//! The webview can't talk to the site-admin Worker directly because
//! Cloudflare Access enforces auth at the edge — credentials need to
//! travel as request headers (Bearer / CF-Access-Client-* / session
//! cookie), and the webview's `fetch` is blocked from setting some of
//! those. So every site-admin call goes through `site_admin_http_request`
//! here, which builds a `reqwest` client with the right headers.
//!
//! `site_admin_browser_login` runs the desktop-client OAuth flow:
//! spin up a localhost callback listener, open the user's default
//! browser at `/api/site-admin/app-auth/authorize`, and wait for the
//! Worker to redirect back with `?token=…&login=…&expiresAt=…`.

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

const BROWSER_LOGIN_TIMEOUT_SECONDS: u64 = 180;

#[derive(Debug, Deserialize)]
pub struct SiteAdminHttpRequest {
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
pub struct SiteAdminHttpResponse {
    ok: bool,
    status: u16,
    body: Value,
}

#[derive(Debug, Serialize)]
pub struct SiteAdminBrowserLoginResult {
    token: String,
    login: String,
    expires_at: String,
}

#[derive(Debug, Serialize)]
pub struct SiteAdminReleaseCommandResult {
    command: String,
    cwd: String,
    status: i32,
    duration_ms: u64,
    stdout_tail: String,
    stderr_tail: String,
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
pub async fn site_admin_http_request(
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
            let snippet = String::from_utf8_lossy(&raw_bytes)
                .chars()
                .take(280)
                .collect::<String>();
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
        ok: (200..300).contains(&status)
            && body.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
        status,
        body,
    })
}

fn package_json_looks_like_repo_root(path: &Path) -> bool {
    let package_json = path.join("package.json");
    let Ok(raw) = std::fs::read_to_string(package_json) else {
        return false;
    };
    raw.contains("\"name\": \"jinnkunn.com\"")
        && raw.contains("\"release:staging\"")
        && path.join("scripts/release-cloudflare.mjs").exists()
}

fn resolve_release_repo_root() -> Result<PathBuf, String> {
    for key in [
        "SITE_ADMIN_LOCAL_RELEASE_ROOT",
        "JINNKUNN_SITE_ROOT",
        "JINNKUNN_COM_ROOT",
    ] {
        if let Ok(value) = std::env::var(key) {
            let candidate = PathBuf::from(value.trim());
            if package_json_looks_like_repo_root(&candidate) {
                return Ok(candidate);
            }
        }
    }

    if let Ok(current) = std::env::current_dir() {
        for candidate in current.ancestors() {
            if package_json_looks_like_repo_root(candidate) {
                return Ok(candidate.to_path_buf());
            }
        }
    }

    let personal_default = PathBuf::from("/Users/jinnkunn/Desktop/jinnkunn.com");
    if package_json_looks_like_repo_root(&personal_default) {
        return Ok(personal_default);
    }

    Err(
        "Could not find jinnkunn.com repo root. Set SITE_ADMIN_LOCAL_RELEASE_ROOT to the checkout path."
            .to_string(),
    )
}

fn allowed_release_script(script: &str) -> Option<&'static str> {
    match script.trim() {
        "release:staging" => Some("release:staging"),
        "release:prod:from-staging" => Some("release:prod:from-staging"),
        "release:prod:from-staging:dry-run" => {
            Some("release:prod:from-staging:dry-run")
        }
        _ => None,
    }
}

fn tail_text(input: &[u8], max_chars: usize) -> String {
    let text = String::from_utf8_lossy(input);
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    chars[chars.len().saturating_sub(max_chars)..]
        .iter()
        .collect()
}

#[tauri::command]
pub async fn site_admin_run_release_command(
    script: String,
) -> Result<SiteAdminReleaseCommandResult, String> {
    let Some(script) = allowed_release_script(&script) else {
        return Err("Unsupported release script.".to_string());
    };
    let cwd = resolve_release_repo_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let output = Command::new("npm")
            .arg("run")
            .arg(script)
            .current_dir(&cwd)
            .env("NO_COLOR", "1")
            .output()
            .or_else(|err| {
                if err.kind() != std::io::ErrorKind::NotFound {
                    return Err(err);
                }
                Command::new("/bin/zsh")
                    .arg("-lc")
                    .arg(format!("npm run {script}"))
                    .current_dir(&cwd)
                    .env("NO_COLOR", "1")
                    .output()
            })
            .map_err(|err| format!("Failed to start npm run {script}: {err}"))?;
        let status = output.status.code().unwrap_or(-1);
        let result = SiteAdminReleaseCommandResult {
            command: format!("npm run {script}"),
            cwd: cwd.display().to_string(),
            status,
            duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            stdout_tail: tail_text(&output.stdout, 5000),
            stderr_tail: tail_text(&output.stderr, 5000),
        };
        if output.status.success() {
            Ok(result)
        } else {
            let detail = [result.stdout_tail.as_str(), result.stderr_tail.as_str()]
                .into_iter()
                .filter(|part| !part.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            Err(format!(
                "{} failed with status {}{}",
                result.command,
                status,
                if detail.is_empty() {
                    String::new()
                } else {
                    format!("\n{}", detail)
                },
            ))
        }
    })
    .await
    .map_err(|err| format!("Release task failed: {err}"))?
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
pub async fn site_admin_browser_login(
    base_url: String,
) -> Result<SiteAdminBrowserLoginResult, String> {
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

    open::that(authorize_url.as_str()).map_err(|e| format!("Failed to open browser: {}", e))?;

    let join =
        tauri::async_runtime::spawn_blocking(move || wait_for_browser_callback(listener, state));
    join.await
        .map_err(|e| format!("Failed to join browser callback task: {}", e))?
}
