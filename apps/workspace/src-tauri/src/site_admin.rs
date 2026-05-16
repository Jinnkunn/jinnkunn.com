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

use rand::Rng;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
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

#[derive(Debug, Clone, Serialize)]
pub struct SiteAdminReleaseJobState {
    job_id: String,
    script: String,
    command: String,
    cwd: String,
    status: String,
    started_at_ms: u64,
    finished_at_ms: Option<u64>,
    duration_ms: Option<u64>,
    exit_code: Option<i32>,
    phase: String,
    stdout_tail: String,
    stderr_tail: String,
    error: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiteAdminReleaseJobEvent {
    job_id: String,
    script: String,
    status: String,
    stream: String,
    phase: String,
    message: String,
    state: SiteAdminReleaseJobState,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiteAdminReleaseHistoryEntry {
    source: String,
    env: String,
    status: String,
    recorded_at: String,
    version_id: String,
    deployment_id: String,
    sha: String,
    branch: String,
    note: String,
    overlay_snapshot_sha: String,
    overlay_backup_snapshot_id: String,
    overlay_rollback_snapshot_id: String,
    rollback_command: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiteAdminLocalReleaseSource {
    sha: String,
    branch: String,
    dirty: bool,
    dirty_file_count: usize,
    dirty_files: Vec<String>,
}

struct ReleaseJobHandle {
    state: Mutex<SiteAdminReleaseJobState>,
    cancel: AtomicBool,
}

static RELEASE_JOBS: OnceLock<Mutex<HashMap<String, Arc<ReleaseJobHandle>>>> = OnceLock::new();

fn release_jobs() -> &'static Mutex<HashMap<String, Arc<ReleaseJobHandle>>> {
    RELEASE_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
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

    if method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE" {
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
        && raw.contains("\"publish:content:staging\"")
        && path.join("scripts/release/release-cloudflare.mjs").exists()
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
        "release:prod:from-staging:dry-run" => Some("release:prod:from-staging:dry-run"),
        "release:status:json" => Some("release:status:json"),
        "release:status:staging:json" => Some("release:status:staging:json"),
        "publish:content:staging" => Some("publish:content:staging"),
        "publish:content:staging:rollback" => Some("publish:content:staging:rollback"),
        "publish:content:staging:clear" => Some("publish:content:staging:clear"),
        "publish:content:prod" => Some("publish:content:prod"),
        "publish:content:prod:from-staging" => Some("publish:content:prod:from-staging"),
        "publish:content:prod:rollback" => Some("publish:content:prod:rollback"),
        "publish:content:prod:clear" => Some("publish:content:prod:clear"),
        _ => None,
    }
}

fn git_text(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|err| format!("Failed to run git {}: {err}", args.join(" ")))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!(
        "git {} failed{}",
        args.join(" "),
        if stderr.is_empty() {
            String::new()
        } else {
            format!(": {stderr}")
        }
    ))
}

fn parse_porcelain_path(line: &str) -> String {
    let path = line.get(3..).unwrap_or("").trim();
    path.split(" -> ").last().unwrap_or(path).trim().to_string()
}

fn read_local_release_source(cwd: &Path) -> Result<SiteAdminLocalReleaseSource, String> {
    let sha = git_text(cwd, &["rev-parse", "HEAD"])?;
    let branch_raw = git_text(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let status = git_text(cwd, &["status", "--porcelain"])?;
    let dirty_files = status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_porcelain_path)
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    Ok(SiteAdminLocalReleaseSource {
        sha,
        branch: if branch_raw == "HEAD" {
            "detached".to_string()
        } else {
            branch_raw
        },
        dirty: !dirty_files.is_empty(),
        dirty_file_count: dirty_files.len(),
        dirty_files,
    })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn make_release_job_id() -> String {
    let nonce: u32 = rand::thread_rng().gen();
    format!("release-{}-{:08x}", now_millis(), nonce)
}

fn append_tail(target: &mut String, input: &str, max_chars: usize) {
    target.push_str(input);
    let chars: Vec<char> = target.chars().collect();
    if chars.len() > max_chars {
        *target = chars[chars.len().saturating_sub(max_chars)..]
            .iter()
            .collect();
    }
}

fn infer_release_phase(line: &str) -> String {
    let lower = line.to_lowercase();
    if lower.contains("rollback") {
        "rollback".to_string()
    } else if lower.contains("snapshot") {
        "snapshot".to_string()
    } else if lower.contains("verifying")
        || lower.contains("verify:")
        || lower.contains("authenticated")
        || lower.contains("visual")
    {
        "verify".to_string()
    } else if lower.contains("overlay") || lower.contains("publish-content") {
        "content".to_string()
    } else if lower.contains("deploying") || lower.contains("deploy:cf") {
        "deploy".to_string()
    } else if lower.contains("uploading") || lower.contains("versions upload") {
        "upload".to_string()
    } else if lower.contains("build:cf") || lower.contains("running build") {
        "build".to_string()
    } else if lower.contains("running public web contracts")
        || lower.contains("running tests")
        || lower.contains("running lint")
        || lower.contains("running script syntax")
    {
        "checks".to_string()
    } else if lower.contains("content snapshot") || lower.contains("dump") {
        "content".to_string()
    } else if lower.contains("reading staging")
        || lower.contains("reading production")
        || lower.contains("git:")
    {
        "preflight".to_string()
    } else if lower.contains("reusing") {
        "cache".to_string()
    } else if lower.contains("done") || lower.contains("\"ok\": true") {
        "complete".to_string()
    } else {
        "running".to_string()
    }
}

fn valid_worker_version_id(value: &str) -> bool {
    let trimmed = value.trim();
    let len = trimmed.len();
    (len == 32 || len == 36)
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() || ch == '-')
}

fn rollback_command(version_id: &str) -> String {
    format!(
        "npx wrangler rollback --env production {} --message \"rollback production to {}\" --yes\nVERIFY_CF_EXPECT_PRODUCTION_VERSION={} npm run verify:cf:prod",
        version_id, version_id, version_id
    )
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

fn emit_release_job_event(
    app: &AppHandle,
    job: &Arc<ReleaseJobHandle>,
    stream: &str,
    phase: &str,
    message: &str,
) {
    let mut state = job.state.lock().unwrap();
    if !phase.is_empty() && phase != "running" {
        state.phase = phase.to_string();
    }
    if stream == "stdout" {
        append_tail(&mut state.stdout_tail, message, 5000);
    } else if stream == "stderr" {
        append_tail(&mut state.stderr_tail, message, 5000);
    }
    let event = SiteAdminReleaseJobEvent {
        job_id: state.job_id.clone(),
        script: state.script.clone(),
        status: state.status.clone(),
        stream: stream.to_string(),
        phase: state.phase.clone(),
        message: message.to_string(),
        state: state.clone(),
    };
    drop(state);
    let _ = app.emit("site-admin://release-job", event);
}

fn set_release_job_terminal_state(
    app: &AppHandle,
    job: &Arc<ReleaseJobHandle>,
    status: &str,
    exit_code: Option<i32>,
    error: &str,
) {
    let mut state = job.state.lock().unwrap();
    let finished_at = now_millis();
    state.status = status.to_string();
    state.finished_at_ms = Some(finished_at);
    state.duration_ms = Some(finished_at.saturating_sub(state.started_at_ms));
    state.exit_code = exit_code;
    state.phase = if status == "succeeded" {
        "complete".to_string()
    } else {
        status.to_string()
    };
    state.error = error.to_string();
    let event = SiteAdminReleaseJobEvent {
        job_id: state.job_id.clone(),
        script: state.script.clone(),
        status: state.status.clone(),
        stream: "status".to_string(),
        phase: state.phase.clone(),
        message: error.to_string(),
        state: state.clone(),
    };
    drop(state);
    let _ = app.emit("site-admin://release-job", event);
}

fn spawn_npm_release_child(script: &str, cwd: &Path) -> Result<Child, String> {
    Command::new("npm")
        .arg("run")
        .arg(script)
        .current_dir(cwd)
        .env("NO_COLOR", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .or_else(|err| {
            if err.kind() != std::io::ErrorKind::NotFound {
                return Err(err);
            }
            Command::new("/bin/zsh")
                .arg("-lc")
                .arg(format!("npm run {script}"))
                .current_dir(cwd)
                .env("NO_COLOR", "1")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        })
        .map_err(|err| format!("Failed to start npm run {script}: {err}"))
}

fn spawn_rollback_child(version_id: &str, cwd: &Path) -> Result<Child, String> {
    if !valid_worker_version_id(version_id) {
        return Err("Invalid Cloudflare Worker version id.".to_string());
    }
    let command = format!(
        "set -a; [ -f .env ] && source .env; set +a; npx wrangler rollback --env production {version_id} --message \"rollback production to {version_id} from workspace\" --yes && VERIFY_CF_EXPECT_PRODUCTION_VERSION={version_id} npm run verify:cf:prod"
    );
    Command::new("/bin/zsh")
        .arg("-lc")
        .arg(command)
        .current_dir(cwd)
        .env("NO_COLOR", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start production rollback: {err}"))
}

fn stream_release_output<R: Read + Send + 'static>(
    app: AppHandle,
    job: Arc<ReleaseJobHandle>,
    stream: &'static str,
    reader: R,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let phase = infer_release_phase(&line);
                    emit_release_job_event(&app, &job, stream, &phase, &line);
                }
                Err(error) => {
                    emit_release_job_event(
                        &app,
                        &job,
                        "stderr",
                        "failed",
                        &format!("Failed to read {stream}: {error}\n"),
                    );
                    break;
                }
            }
        }
    });
}

fn start_release_job(
    app: AppHandle,
    script: String,
    command: String,
    cwd: PathBuf,
    spawn: impl FnOnce(&Path) -> Result<Child, String> + Send + 'static,
) -> SiteAdminReleaseJobState {
    let job_id = make_release_job_id();
    let state = SiteAdminReleaseJobState {
        job_id: job_id.clone(),
        script: script.clone(),
        command,
        cwd: cwd.display().to_string(),
        status: "running".to_string(),
        started_at_ms: now_millis(),
        finished_at_ms: None,
        duration_ms: None,
        exit_code: None,
        phase: "starting".to_string(),
        stdout_tail: String::new(),
        stderr_tail: String::new(),
        error: String::new(),
    };
    let job = Arc::new(ReleaseJobHandle {
        state: Mutex::new(state.clone()),
        cancel: AtomicBool::new(false),
    });
    release_jobs()
        .lock()
        .unwrap()
        .insert(job_id.clone(), Arc::clone(&job));

    let app_for_thread = app.clone();
    let job_for_thread = Arc::clone(&job);
    thread::spawn(move || {
        emit_release_job_event(
            &app_for_thread,
            &job_for_thread,
            "status",
            "starting",
            "Release job started.\n",
        );
        let mut child = match spawn(&cwd) {
            Ok(child) => child,
            Err(error) => {
                set_release_job_terminal_state(
                    &app_for_thread,
                    &job_for_thread,
                    "failed",
                    Some(-1),
                    &error,
                );
                return;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            stream_release_output(
                app_for_thread.clone(),
                Arc::clone(&job_for_thread),
                "stdout",
                stdout,
            );
        }
        if let Some(stderr) = child.stderr.take() {
            stream_release_output(
                app_for_thread.clone(),
                Arc::clone(&job_for_thread),
                "stderr",
                stderr,
            );
        }

        loop {
            if job_for_thread.cancel.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                set_release_job_terminal_state(
                    &app_for_thread,
                    &job_for_thread,
                    "cancelled",
                    Some(-1),
                    "Cancelled by operator.",
                );
                return;
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    let code = status.code().unwrap_or(-1);
                    if status.success() {
                        set_release_job_terminal_state(
                            &app_for_thread,
                            &job_for_thread,
                            "succeeded",
                            Some(code),
                            "",
                        );
                    } else {
                        set_release_job_terminal_state(
                            &app_for_thread,
                            &job_for_thread,
                            "failed",
                            Some(code),
                            &format!("Command exited with status {code}."),
                        );
                    }
                    return;
                }
                Ok(None) => thread::sleep(Duration::from_millis(250)),
                Err(error) => {
                    set_release_job_terminal_state(
                        &app_for_thread,
                        &job_for_thread,
                        "failed",
                        Some(-1),
                        &format!("Failed to wait for release process: {error}"),
                    );
                    return;
                }
            }
        }
    });

    state
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
            stdout_tail: tail_text(&output.stdout, 120_000),
            stderr_tail: tail_text(&output.stderr, 20_000),
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

#[tauri::command]
pub async fn site_admin_start_release_job(
    app: AppHandle,
    script: String,
) -> Result<SiteAdminReleaseJobState, String> {
    let Some(script) = allowed_release_script(&script) else {
        return Err("Unsupported release script.".to_string());
    };
    let cwd = resolve_release_repo_root()?;
    Ok(start_release_job(
        app,
        script.to_string(),
        format!("npm run {script}"),
        cwd,
        {
            let script = script.to_string();
            move |cwd| spawn_npm_release_child(&script, cwd)
        },
    ))
}

#[tauri::command]
pub async fn site_admin_start_rollback_job(
    app: AppHandle,
    version_id: String,
) -> Result<SiteAdminReleaseJobState, String> {
    let version_id = version_id.trim().to_string();
    if !valid_worker_version_id(&version_id) {
        return Err("Invalid Cloudflare Worker version id.".to_string());
    }
    let cwd = resolve_release_repo_root()?;
    Ok(start_release_job(
        app,
        format!("rollback:production:{version_id}"),
        rollback_command(&version_id),
        cwd,
        move |cwd| spawn_rollback_child(&version_id, cwd),
    ))
}

#[tauri::command]
pub async fn site_admin_release_job_status(
    job_id: String,
) -> Result<Option<SiteAdminReleaseJobState>, String> {
    let job = {
        let jobs = release_jobs().lock().unwrap();
        jobs.get(job_id.trim()).cloned()
    };
    let Some(job) = job else {
        return Ok(None);
    };
    let state = job.state.lock().unwrap().clone();
    Ok(Some(state))
}

#[tauri::command]
pub async fn site_admin_cancel_release_job(
    job_id: String,
) -> Result<Option<SiteAdminReleaseJobState>, String> {
    let job = {
        let jobs = release_jobs().lock().unwrap();
        jobs.get(job_id.trim()).cloned()
    };
    let Some(job) = job else {
        return Ok(None);
    };
    job.cancel.store(true, Ordering::SeqCst);
    let state = job.state.lock().unwrap().clone();
    Ok(Some(state))
}

fn strip_markdown_code(value: &str) -> String {
    value.trim().trim_matches('`').trim().to_string()
}

fn parse_production_history(root: &Path, entries: &mut Vec<SiteAdminReleaseHistoryEntry>) {
    let path = root.join("docs/runbooks/production-version-history.md");
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    for line in raw.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('|') || !trimmed.contains('`') {
            continue;
        }
        let cols: Vec<String> = trimmed
            .trim_matches('|')
            .split('|')
            .map(|part| part.trim().to_string())
            .collect();
        if cols.len() < 6 || cols[0].starts_with("---") || cols[0] == "Snapshot at (UTC)" {
            continue;
        }
        let version_id = strip_markdown_code(&cols[1]);
        if version_id.is_empty() || version_id == "(none)" {
            continue;
        }
        entries.push(SiteAdminReleaseHistoryEntry {
            source: "production-version-history".to_string(),
            env: "production".to_string(),
            status: "snapshot".to_string(),
            recorded_at: cols[0].clone(),
            version_id: version_id.clone(),
            deployment_id: strip_markdown_code(&cols[2]),
            sha: strip_markdown_code(&cols[3]),
            branch: cols[4].clone(),
            note: cols[5].clone(),
            overlay_snapshot_sha: String::new(),
            overlay_backup_snapshot_id: String::new(),
            overlay_rollback_snapshot_id: String::new(),
            rollback_command: rollback_command(&version_id),
        });
    }
}

fn value_string(value: Option<&Value>) -> String {
    value
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string()
}

fn parse_release_jsonl_history(root: &Path, entries: &mut Vec<SiteAdminReleaseHistoryEntry>) {
    let path = root.join(".cache/release/release-history.jsonl");
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    for line in raw.lines().rev() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let env = value_string(value.get("env"));
        let deployed = value_string(value.get("deployedVersionId"));
        let failure = value_string(value.get("failure"));
        let rolled_back = value
            .get("rolledBack")
            .and_then(|v| v.get("target"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let explicit_status = value_string(value.get("status"));
        let status = if !failure.is_empty() {
            "failed"
        } else if !rolled_back.is_empty() {
            "rolled-back"
        } else if !explicit_status.is_empty() {
            explicit_status.as_str()
        } else {
            "succeeded"
        };
        let rollback = if env == "production" && !deployed.is_empty() {
            rollback_command(&deployed)
        } else {
            String::new()
        };
        let note = value_string(value.get("note"));
        entries.push(SiteAdminReleaseHistoryEntry {
            source: "release-history".to_string(),
            env,
            status: status.to_string(),
            recorded_at: {
                let recorded_at = value_string(value.get("recordedAt"));
                if recorded_at.is_empty() {
                    value_string(value.get("snapshotAt"))
                } else {
                    recorded_at
                }
            },
            version_id: deployed.clone(),
            deployment_id: value_string(value.get("deploymentId")),
            sha: value_string(value.get("sha")),
            branch: value_string(value.get("branch")),
            note: if failure.is_empty() {
                note
            } else {
                failure
            },
            overlay_snapshot_sha: value_string(value.get("overlaySnapshotSha")),
            overlay_backup_snapshot_id: value_string(value.get("overlayBackupSnapshotId")),
            overlay_rollback_snapshot_id: value_string(value.get("overlayRollbackSnapshotId")),
            rollback_command: rollback,
        });
    }
}

#[tauri::command]
pub async fn site_admin_release_history(
    limit: Option<usize>,
) -> Result<Vec<SiteAdminReleaseHistoryEntry>, String> {
    let root = resolve_release_repo_root()?;
    let mut entries = Vec::new();
    parse_release_jsonl_history(&root, &mut entries);
    parse_production_history(&root, &mut entries);
    let limit = limit.unwrap_or(12);
    entries.truncate(limit);
    Ok(entries)
}

#[tauri::command]
pub async fn site_admin_local_release_source() -> Result<SiteAdminLocalReleaseSource, String> {
    let root = resolve_release_repo_root()?;
    tauri::async_runtime::spawn_blocking(move || read_local_release_source(&root))
        .await
        .map_err(|err| format!("Local release source task failed: {err}"))?
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
