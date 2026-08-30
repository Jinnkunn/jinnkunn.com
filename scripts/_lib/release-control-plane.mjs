/**
 * Shared release control plane: cross-process release locks and a durable,
 * machine-independent release history.
 *
 * Both tables live in the STAGING content D1 — the same database that already
 * hosts the release_jobs queue for both environments (see the
 * SITE_ADMIN_RELEASE_DB comment in wrangler.toml). The Mac mini runner, a
 * laptop CLI invocation, and the GitHub Actions fallback all reach it with the
 * CLOUDFLARE_API_TOKEN they already carry, which is what makes a lock that
 * spans machines (and an audit trail that survives any one machine) possible.
 *
 * Locks: the runner's in-process claimGate only serializes jobs inside one
 * agent process. A direct `npm run release:staging` from a laptop never touches
 * the job queue, so it could interleave with a runner job on the same Worker —
 * a stale-job race did exactly that once (see TERMINAL_RELEASE_STATUSES in
 * release-agent.mjs). `acquireReleaseLock` closes that hole for every entry
 * point that mutates an environment.
 *
 * Escape hatches (both intentionally loud):
 *   FORCE_RELEASE_LOCK=1     steal a lock that is genuinely stuck.
 *   RELEASE_CONTROL_PLANE=0  skip locking + remote history entirely, for when
 *                            the control-plane D1 itself is unreachable.
 */

import crypto from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import fs from "node:fs";

import { d1DatabaseIdForEnv } from "./wrangler-d1.mjs";

// release_locks / release_history / release_jobs all live in the staging DB.
const CONTROL_PLANE_ENV = "staging";
const DEFAULT_LOCK_TTL_MS = 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 15_000;
const SIGNAL_RELEASE_TIMEOUT_MS = 4_000;
// Processes under the same lock cooperate through this env var: a child
// spawned by a script that already holds the lock for an environment inherits
// membership instead of deadlocking against its parent (release-cloudflare →
// publish-content --clear, release-from-staging → release:prod, …).
const HELD_ENVS_VAR = "RELEASE_LOCK_HELD_ENVS";

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

export function controlPlaneDisabled() {
  return readEnv("RELEASE_CONTROL_PLANE") === "0";
}

function d1Rows(result) {
  if (Array.isArray(result)) {
    for (const item of result) {
      if (Array.isArray(item?.results)) return item.results;
    }
  }
  if (Array.isArray(result?.results)) return result.results;
  return [];
}

// One query function per repo root, so schema ensure-once and lock release
// share the same identity across every call in a process.
const queriesByRoot = new Map();

function controlPlaneQueryFor(root) {
  const key = path.resolve(String(root || ""));
  let query = queriesByRoot.get(key);
  if (!query) {
    query = createControlPlaneQuery({ root: key });
    queriesByRoot.set(key, query);
  }
  return query;
}

function createControlPlaneQuery({ root }) {
  return async function controlPlaneQuery({ sql, params = [], timeoutMs = QUERY_TIMEOUT_MS }) {
    const accountId = readEnv("CLOUDFLARE_ACCOUNT_ID") || readEnv("CF_ACCOUNT_ID");
    const apiToken = readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN");
    if (!accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
    if (!apiToken) throw new Error("Missing CLOUDFLARE_API_TOKEN");
    const databaseId = d1DatabaseIdForEnv({ root, env: CONTROL_PLANE_ENV });
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Cloudflare D1 returned non-JSON: ${text.slice(0, 240)}`);
    }
    if (!response.ok || payload?.success === false) {
      const errors = Array.isArray(payload?.errors)
        ? payload.errors.map((item) => item.message).join("; ")
        : text;
      throw new Error(`Cloudflare D1 query failed (${response.status}): ${errors}`);
    }
    return payload?.result;
  };
}

// Mirrors migrations/009_release_control_plane.sql so a release does not
// depend on the operator having run `db:migrate` first (same self-healing
// pattern as ensureOverlayTable in publish-content.mjs). Ensured once per
// process per query function.
const ensuredSchemas = new WeakSet();

async function ensureControlPlaneTables(query) {
  if (ensuredSchemas.has(query)) return;
  await query({
    sql: `CREATE TABLE IF NOT EXISTS release_locks (
      environment  TEXT PRIMARY KEY,
      holder       TEXT NOT NULL,
      operation    TEXT,
      acquired_at  INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    )`,
  });
  await query({
    sql: `CREATE TABLE IF NOT EXISTS release_history (
      id                   TEXT PRIMARY KEY,
      recorded_at          INTEGER NOT NULL,
      source               TEXT NOT NULL,
      env                  TEXT NOT NULL,
      ok                   INTEGER NOT NULL DEFAULT 1,
      sha                  TEXT,
      branch               TEXT,
      deployed_version_id  TEXT,
      deployment_id        TEXT,
      note                 TEXT,
      detail_json          TEXT
    )`,
  });
  await query({
    sql: "CREATE INDEX IF NOT EXISTS idx_release_history_recorded ON release_history (recorded_at DESC)",
  });
  await query({
    sql: "CREATE INDEX IF NOT EXISTS idx_release_history_env_recorded ON release_history (env, recorded_at DESC)",
  });
  ensuredSchemas.add(query);
}

const HOLDER_ID = `${hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;

function heldEnvironments() {
  return new Set(
    readEnv(HELD_ENVS_VAR)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function markHeld(environment) {
  const held = heldEnvironments();
  held.add(environment);
  process.env[HELD_ENVS_VAR] = [...held].join(",");
}

function unmarkHeld(environment) {
  const held = heldEnvironments();
  held.delete(environment);
  if (held.size === 0) delete process.env[HELD_ENVS_VAR];
  else process.env[HELD_ENVS_VAR] = [...held].join(",");
}

export function parseLockHolder(holder) {
  const [host = "", pid = "", nonce = ""] = String(holder || "").split(":");
  return { host, pid: Number.parseInt(pid, 10) || 0, nonce };
}

function localPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error?.code === "EPERM";
  }
}

/**
 * A lock held by a dead process on THIS machine is safe to reclaim
 * immediately instead of waiting out the TTL — a canceled runner job gets
 * SIGKILLed without running its release path, and making the operator wait
 * an hour to retry would be worse than the race the lock prevents.
 */
export function isReclaimableLocalLock(held, { host = hostname(), pidAlive = localPidAlive } = {}) {
  const parsed = parseLockHolder(held?.holder);
  if (!parsed.host || parsed.host !== host) return false;
  if (!parsed.pid || parsed.pid === process.pid) return false;
  return !pidAlive(parsed.pid);
}

const liveLocks = new Set();
let signalHandlersInstalled = false;

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      const pending = [...liveLocks].map((lock) =>
        lock.release({ timeoutMs: SIGNAL_RELEASE_TIMEOUT_MS }),
      );
      void Promise.allSettled(pending).then(() => {
        process.exit(signal === "SIGINT" ? 130 : 143);
      });
      // If the release hangs past its timeout something is deeply wrong;
      // don't hold the process hostage.
      setTimeout(() => process.exit(signal === "SIGINT" ? 130 : 143), SIGNAL_RELEASE_TIMEOUT_MS + 1000).unref?.();
    });
  }
}

export function formatHeldLock(held) {
  const expiresInMin = Math.max(0, Math.ceil((Number(held?.expires_at || 0) - Date.now()) / 60000));
  return [
    `another release currently holds the ${held?.environment || "release"} lock:`,
    `  holder:    ${held?.holder || "unknown"}`,
    `  operation: ${held?.operation || "unknown"}`,
    `  expires:   in ~${expiresInMin} min`,
    "Wait for it to finish, or set FORCE_RELEASE_LOCK=1 only when you are certain that release is dead.",
  ].join("\n");
}

/**
 * Acquire the per-environment release lock in the shared control-plane D1.
 *
 * Returns `{ ok: true, release() }` when acquired (or inherited from a parent
 * process / skipped via RELEASE_CONTROL_PLANE=0), and `{ ok: false, held }`
 * when another live process holds it. Throws when the control plane itself is
 * unreachable — a release should fail closed rather than run unserialized;
 * RELEASE_CONTROL_PLANE=0 is the documented emergency bypass.
 */
export async function acquireReleaseLock({
  root,
  environment,
  operation,
  ttlMs = DEFAULT_LOCK_TTL_MS,
  force = readEnv("FORCE_RELEASE_LOCK") === "1",
  query,
  logger = console,
}) {
  const noop = async () => {};
  if (controlPlaneDisabled()) {
    logger.warn(
      `[release-lock] RELEASE_CONTROL_PLANE=0 — skipping the ${environment} release lock (unserialized release)`,
    );
    return { ok: true, skipped: true, release: noop };
  }
  if (heldEnvironments().has(environment)) {
    // A parent process in this release already holds it; run under its lock.
    return { ok: true, inherited: true, release: noop };
  }

  query ||= controlPlaneQueryFor(root);
  await ensureControlPlaneTables(query);
  const attempt = async (steal) => {
    const now = Date.now();
    const conflictGuard = steal
      ? ""
      : `WHERE release_locks.expires_at <= excluded.acquired_at
           OR release_locks.holder = excluded.holder`;
    await query({
      sql: `INSERT INTO release_locks (environment, holder, operation, acquired_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(environment) DO UPDATE SET
          holder = excluded.holder,
          operation = excluded.operation,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at
        ${conflictGuard}`,
      params: [environment, HOLDER_ID, String(operation || ""), now, now + ttlMs],
    });
    const rows = d1Rows(
      await query({
        sql: "SELECT environment, holder, operation, acquired_at, expires_at FROM release_locks WHERE environment = ?",
        params: [environment],
      }),
    );
    return rows[0] || null;
  };

  if (force) {
    logger.warn(
      `[release-lock] FORCE_RELEASE_LOCK=1 — stealing the ${environment} lock regardless of holder`,
    );
  }
  let row = await attempt(force);
  if (row && row.holder !== HOLDER_ID && isReclaimableLocalLock(row)) {
    logger.warn(
      `[release-lock] reclaiming ${environment} lock from dead local process ${row.holder}`,
    );
    row = await attempt(true);
  }
  if (!row || row.holder !== HOLDER_ID) {
    return { ok: false, held: row ? { ...row, environment } : null };
  }

  markHeld(environment);
  const lock = {
    ok: true,
    holder: HOLDER_ID,
    environment,
    async release({ timeoutMs = QUERY_TIMEOUT_MS } = {}) {
      if (!liveLocks.has(lock)) return;
      liveLocks.delete(lock);
      unmarkHeld(environment);
      try {
        await query({
          sql: "DELETE FROM release_locks WHERE environment = ? AND holder = ?",
          params: [environment, HOLDER_ID],
          timeoutMs,
        });
      } catch (error) {
        // A leaked lock self-heals via TTL; never let cleanup mask the
        // release outcome.
        logger.warn(
          `[release-lock] failed to release ${environment} lock (expires on its own): ${error?.message || error}`,
        );
      }
    },
  };
  liveLocks.add(lock);
  installSignalHandlers();
  logger.log(
    `[release-lock] acquired ${environment} lock as ${HOLDER_ID}${operation ? ` (${operation})` : ""}`,
  );
  return lock;
}

/**
 * Best-effort append of a release/publish/rollback record to the shared
 * release_history table. Never throws — remote audit must not block or fail a
 * release; the local JSONL under .cache/release/ remains the fallback record.
 */
export async function recordRemoteReleaseHistory({
  root,
  entry,
  query,
  logger = console,
}) {
  if (controlPlaneDisabled()) return false;
  try {
    query ||= controlPlaneQueryFor(root);
    await ensureControlPlaneTables(query);
    const {
      source = "unknown",
      env = "unknown",
      ok,
      failure,
      sha = "",
      branch = "",
      deployedVersionId = "",
      deploymentId = "",
      note = "",
      ...detail
    } = entry || {};
    const succeeded = ok === false || failure ? 0 : 1;
    await query({
      sql: `INSERT INTO release_history
        (id, recorded_at, source, env, ok, sha, branch, deployed_version_id, deployment_id, note, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        crypto.randomUUID(),
        Date.now(),
        String(source),
        String(env),
        succeeded,
        String(sha || ""),
        String(branch || ""),
        String(deployedVersionId || ""),
        String(deploymentId || ""),
        String(note || failure || ""),
        Object.keys(detail).length > 0 ? JSON.stringify(detail) : null,
      ],
    });
    return true;
  } catch (error) {
    logger.warn(
      `[release-history] failed to record remote release history (local JSONL still written): ${error?.message || error}`,
    );
    return false;
  }
}

/**
 * Convenience for scripts: write the local JSONL line AND the remote row for
 * one entry. `localPath` keeps each script's existing on-disk audit location.
 */
export async function recordReleaseHistoryEverywhere({ root, localPath, entry, logger = console }) {
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.appendFileSync(
      localPath,
      `${JSON.stringify({ ...entry, recordedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
  } catch (error) {
    logger.error(
      `[release-history] failed to append local release history: ${error?.message || error}`,
    );
  }
  await recordRemoteReleaseHistory({ root, entry, logger });
}
