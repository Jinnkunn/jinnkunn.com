const TOKEN_ISSUER = "site-admin";
const TOKEN_AUDIENCE = "site-admin-app";

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function textDecoder() {
  return new TextDecoder();
}

function normalizeLogin(value) {
  return String(value || "").trim().toLowerCase();
}

function allowedUsers(env) {
  const out = new Set();
  for (const part of String(env?.SITE_ADMIN_GITHUB_USERS || "").split(/[,\n]/)) {
    const login = normalizeLogin(part.replace(/^@+/, ""));
    if (login) out.add(login);
  }
  return out;
}

function tokenSecret(env) {
  return String(
    env?.SITE_ADMIN_APP_TOKEN_SECRET ||
      env?.NEXTAUTH_SECRET ||
      env?.AUTH_SECRET ||
      "",
  ).trim();
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256Base64Url(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

function timingSafeEqualString(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function inferEnvironment(url, env) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "staging.jinkunchen.com" || hostname.startsWith("staging.")) {
    return "staging";
  }
  if (hostname === "jinkunchen.com" || hostname === "www.jinkunchen.com") {
    return "production";
  }
  const raw = String(env?.CLOUDFLARE_DEPLOY_ENV || env?.DEPLOY_ENV || "").toLowerCase();
  if (raw === "staging") return "staging";
  if (raw === "production" || raw === "prod") return "production";
  return null;
}

function bearerToken(request) {
  const raw = String(request.headers.get("authorization") || "").trim();
  const [scheme, ...rest] = raw.split(/\s+/);
  if (String(scheme || "").toLowerCase() !== "bearer") return "";
  return rest.join(" ").trim();
}

async function verifyAppToken(request, env) {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: "Unauthorized" };
  const secret = tokenSecret(env);
  if (!secret) {
    return { ok: false, status: 500, error: "Server misconfigured: missing app token secret" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401, error: "Unauthorized" };
  const [headerPart, payloadPart, signature] = parts;
  const expected = await hmacSha256Base64Url(`${headerPart}.${payloadPart}`, secret);
  if (!timingSafeEqualString(signature, expected)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  let payload = null;
  try {
    payload = JSON.parse(textDecoder().decode(base64UrlToBytes(payloadPart)));
  } catch {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (payload?.iss !== TOKEN_ISSUER || payload?.aud !== TOKEN_AUDIENCE) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const login = normalizeLogin(payload.sub);
  if (!login || !allowedUsers(env).has(login)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const expectedEnv = inferEnvironment(request.url, env);
  if (expectedEnv && payload.env !== expectedEnv) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true, login };
}

function db(env) {
  const candidate = env?.SITE_ADMIN_DB;
  return candidate && typeof candidate.prepare === "function" ? candidate : null;
}

async function first(database, sql, ...bindings) {
  if (!database) return null;
  try {
    return await database.prepare(sql).bind(...bindings).first();
  } catch {
    return null;
  }
}

async function all(database, sql, ...bindings) {
  if (!database) return [];
  try {
    const out = await database.prepare(sql).bind(...bindings).all();
    return Array.isArray(out?.results) ? out.results : [];
  } catch {
    return [];
  }
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function bodyToText(value) {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return textDecoder().decode(value);
  if (ArrayBuffer.isView(value)) {
    return textDecoder().decode(value);
  }
  return "";
}

function normalizeNow(raw) {
  const fallback = {
    current: { text: "Working quietly.", context: "", location: "", updatedAt: "" },
    updates: [],
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const current = raw.current && typeof raw.current === "object" ? raw.current : {};
  return {
    current: {
      text: str(current.text) || fallback.current.text,
      context: str(current.context),
      location: str(current.location),
      updatedAt: str(current.updatedAt),
    },
    updates: Array.isArray(raw.updates) ? raw.updates : [],
  };
}

async function readNow(database) {
  const row = await first(database, "SELECT body FROM content_files WHERE rel_path = ? LIMIT 1", "now.json");
  const body = await bodyToText(row?.body);
  try {
    return normalizeNow(JSON.parse(body));
  } catch {
    return normalizeNow(null);
  }
}

async function contentCounts(database) {
  const [posts, pages] = await Promise.all([
    first(
      database,
      `SELECT COUNT(*) AS count FROM content_files
        WHERE rel_path LIKE 'posts/%'
          AND (rel_path LIKE '%.mdx' OR rel_path LIKE '%.md')`,
    ),
    first(
      database,
      `SELECT COUNT(*) AS count FROM content_files
        WHERE rel_path LIKE 'pages/%'
          AND (rel_path LIKE '%.mdx' OR rel_path LIKE '%.md')`,
    ),
  ]);
  return { posts: num(posts?.count), pages: num(pages?.count) };
}

async function calendarSummary(database) {
  const state = await first(
    database,
    `SELECT generated_at, range_starts_at, range_ends_at, event_count
       FROM calendar_public_sync_state
      ORDER BY updated_at DESC
      LIMIT 1`,
  );
  if (state) {
    return {
      generatedAt: str(state.generated_at),
      eventCount: num(state.event_count),
      rangeStartsAt: str(state.range_starts_at),
      rangeEndsAt: str(state.range_ends_at),
    };
  }
  const count = await first(database, "SELECT COUNT(*) AS count FROM calendar_public_events");
  return {
    generatedAt: "",
    eventCount: num(count?.count),
    rangeStartsAt: "",
    rangeEndsAt: "",
  };
}

function mapJob(row) {
  return {
    id: str(row.id),
    action: str(row.action),
    script: str(row.script),
    target: str(row.target) === "production" ? "production" : "staging",
    status: str(row.status),
    phase: str(row.phase),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
    finishedAt: row.finished_at == null ? null : num(row.finished_at),
    error: str(row.error),
  };
}

function mapRunner(row) {
  return {
    agentId: str(row.agent_id),
    status: str(row.status) === "running" ? "running" : "idle",
    currentJobId: str(row.current_job_id),
    lastSeenAt: num(row.last_seen_at),
  };
}

async function releaseSummary(database) {
  const jobs = (await all(
    database,
    `SELECT id, action, script, target, status, phase, created_at, updated_at, finished_at, error
       FROM release_jobs
      ORDER BY updated_at DESC
      LIMIT 5`,
  )).map(mapJob);
  const runners = (await all(
    database,
    `SELECT agent_id, status, current_job_id, last_seen_at
       FROM release_agents
      ORDER BY last_seen_at DESC
      LIMIT 4`,
  )).map(mapRunner);
  const runningJob = jobs.find((job) => job.status === "queued" || job.status === "running") || null;
  return {
    headline: runningJob ? `${runningJob.status === "queued" ? "Queued" : "Running"}: ${runningJob.script}` : "Up to date",
    detail: runningJob ? runningJob.phase || "Release job is active." : "No mobile release action is needed.",
    recommendedAction: runningJob
      ? { kind: "watch-release", label: "View Release", destructive: false }
      : { kind: "noop", label: "Current", destructive: false },
    runningJob,
    latestJob: jobs[0] || null,
    runners,
  };
}

async function contentSha(database) {
  const row = await first(
    database,
    `SELECT sha FROM content_files
      ORDER BY updated_at DESC
      LIMIT 1`,
  );
  return str(row?.sha).slice(0, 7);
}

export async function handleMobileSummaryRequest(request, env) {
  if (String(request.method || "GET").toUpperCase() !== "GET") {
    return json({ ok: false, error: "Method Not Allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }
  const auth = await verifyAppToken(request, env);
  if (!auth.ok) {
    return json(
      { ok: false, error: auth.error, code: auth.status === 500 ? "MISCONFIGURED" : "UNAUTHORIZED" },
      { status: auth.status },
    );
  }

  const database = db(env);
  if (!database) {
    return json({ ok: false, error: "Server misconfigured: missing SITE_ADMIN_DB", code: "MISCONFIGURED" }, { status: 500 });
  }

  const [now, content, calendar, release, latestContentSha] = await Promise.all([
    readNow(database),
    contentCounts(database),
    calendarSummary(database),
    releaseSummary(database),
    contentSha(database),
  ]);
  const envName = inferEnvironment(request.url, env) || "";
  const branch = str(env?.SITE_ADMIN_REPO_BRANCH) || (envName === "production" ? "main" : "site-admin-staging");

  return json({
    ok: true,
    data: {
      summary: {
        generatedAt: new Date().toISOString(),
        site: {
          name: "jinkunchen.com",
          environment: branch,
          runtime: "cloudflare",
        },
        now: {
          text: str(now.current.text),
          context: str(now.current.context),
          location: str(now.current.location),
          updatedAt: str(now.current.updatedAt),
          historyCount: Array.isArray(now.updates) ? now.updates.length : 0,
        },
        calendar,
        content,
        release,
        source: {
          storeKind: str(env?.SITE_ADMIN_STORAGE) || "db",
          branch,
          codeSha: "",
          contentSha: latestContentSha,
          pendingDeploy: null,
          deployableVersionReady: null,
        },
      },
    },
  });
}
