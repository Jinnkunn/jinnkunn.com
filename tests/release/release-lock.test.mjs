import assert from "node:assert/strict";
import { hostname } from "node:os";
import test from "node:test";

import {
  acquireReleaseLock,
  isReclaimableLocalLock,
  parseLockHolder,
  recordRemoteReleaseHistory,
} from "../../scripts/_lib/release-control-plane.mjs";

const silent = { log() {}, warn() {}, error() {} };

// Minimal in-memory D1 stand-in implementing the SQL shapes the module uses.
function createFakeControlPlane() {
  const locks = new Map();
  const history = [];
  let calls = 0;
  const query = async ({ sql, params = [] }) => {
    calls += 1;
    const s = sql.trim();
    if (s.startsWith("CREATE")) return [];
    if (s.startsWith("INSERT INTO release_locks")) {
      const [environment, holder, operation, acquiredAt, expiresAt] = params;
      const row = {
        environment,
        holder,
        operation,
        acquired_at: acquiredAt,
        expires_at: expiresAt,
      };
      const existing = locks.get(environment);
      const guarded = /WHERE release_locks\.expires_at/.test(s);
      if (
        !existing ||
        !guarded ||
        existing.expires_at <= acquiredAt ||
        existing.holder === holder
      ) {
        locks.set(environment, row);
      }
      return [];
    }
    if (s.startsWith("SELECT") && s.includes("FROM release_locks")) {
      const row = locks.get(params[0]);
      return [{ results: row ? [row] : [] }];
    }
    if (s.startsWith("DELETE FROM release_locks")) {
      const [environment, holder] = params;
      const row = locks.get(environment);
      if (row && row.holder === holder) locks.delete(environment);
      return [];
    }
    if (s.startsWith("INSERT INTO release_history")) {
      history.push(params);
      return [];
    }
    throw new Error(`unexpected sql in fake control plane: ${s.slice(0, 60)}`);
  };
  return {
    locks,
    history,
    query,
    get calls() {
      return calls;
    },
  };
}

function withEnv(t, patch) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === null || value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("release lock: acquire and release round-trips", async (t) => {
  withEnv(t, { RELEASE_LOCK_HELD_ENVS: null, FORCE_RELEASE_LOCK: null, RELEASE_CONTROL_PLANE: null });
  const plane = createFakeControlPlane();
  const lock = await acquireReleaseLock({
    environment: "staging",
    operation: "test",
    query: plane.query,
    logger: silent,
  });
  assert.equal(lock.ok, true);
  assert.equal(plane.locks.get("staging").holder, lock.holder);
  assert.equal(process.env.RELEASE_LOCK_HELD_ENVS, "staging");
  await lock.release();
  assert.equal(plane.locks.has("staging"), false);
  assert.equal(process.env.RELEASE_LOCK_HELD_ENVS, undefined);
});

test("release lock: a live foreign holder refuses the acquire", async (t) => {
  withEnv(t, { RELEASE_LOCK_HELD_ENVS: null, FORCE_RELEASE_LOCK: null, RELEASE_CONTROL_PLANE: null });
  const plane = createFakeControlPlane();
  plane.locks.set("production", {
    environment: "production",
    holder: "other-machine:4242:ab12cd",
    operation: "release-cloudflare production",
    acquired_at: Date.now(),
    expires_at: Date.now() + 30 * 60 * 1000,
  });
  const lock = await acquireReleaseLock({
    environment: "production",
    operation: "test",
    query: plane.query,
    logger: silent,
  });
  assert.equal(lock.ok, false);
  assert.equal(lock.held.holder, "other-machine:4242:ab12cd");
  assert.equal(plane.locks.get("production").holder, "other-machine:4242:ab12cd");
});

test("release lock: an expired foreign holder is taken over", async (t) => {
  withEnv(t, { RELEASE_LOCK_HELD_ENVS: null, FORCE_RELEASE_LOCK: null, RELEASE_CONTROL_PLANE: null });
  const plane = createFakeControlPlane();
  plane.locks.set("staging", {
    environment: "staging",
    holder: "other-machine:4242:ab12cd",
    operation: "stale",
    acquired_at: Date.now() - 2 * 60 * 60 * 1000,
    expires_at: Date.now() - 60 * 60 * 1000,
  });
  const lock = await acquireReleaseLock({
    environment: "staging",
    operation: "test",
    query: plane.query,
    logger: silent,
  });
  assert.equal(lock.ok, true);
  await lock.release();
});

test("release lock: force steals a live foreign lock", async (t) => {
  withEnv(t, { RELEASE_LOCK_HELD_ENVS: null, RELEASE_CONTROL_PLANE: null });
  const plane = createFakeControlPlane();
  plane.locks.set("staging", {
    environment: "staging",
    holder: "other-machine:4242:ab12cd",
    operation: "live",
    acquired_at: Date.now(),
    expires_at: Date.now() + 30 * 60 * 1000,
  });
  const lock = await acquireReleaseLock({
    environment: "staging",
    operation: "test",
    force: true,
    query: plane.query,
    logger: silent,
  });
  assert.equal(lock.ok, true);
  await lock.release();
});

test("release lock: a child process under the parent's lock inherits it", async (t) => {
  withEnv(t, { RELEASE_LOCK_HELD_ENVS: "production", RELEASE_CONTROL_PLANE: null });
  const plane = createFakeControlPlane();
  const lock = await acquireReleaseLock({
    environment: "production",
    operation: "child",
    query: plane.query,
    logger: silent,
  });
  assert.equal(lock.ok, true);
  assert.equal(lock.inherited, true);
  assert.equal(plane.calls, 0, "inherited lock must not touch the control plane");
  await lock.release();
  assert.equal(process.env.RELEASE_LOCK_HELD_ENVS, "production", "release of an inherited lock is a no-op");
});

test("release lock: RELEASE_CONTROL_PLANE=0 skips locking loudly", async (t) => {
  withEnv(t, { RELEASE_CONTROL_PLANE: "0", RELEASE_LOCK_HELD_ENVS: null });
  const plane = createFakeControlPlane();
  const warnings = [];
  const lock = await acquireReleaseLock({
    environment: "staging",
    operation: "test",
    query: plane.query,
    logger: { ...silent, warn: (line) => warnings.push(line) },
  });
  assert.equal(lock.ok, true);
  assert.equal(lock.skipped, true);
  assert.equal(plane.calls, 0);
  assert.match(warnings.join("\n"), /RELEASE_CONTROL_PLANE=0/);
});

test("release lock: dead local holder is reclaimable, live and foreign are not", () => {
  const host = hostname();
  const dead = { holder: `${host}:99999:aa` };
  assert.equal(isReclaimableLocalLock(dead, { host, pidAlive: () => false }), true);
  assert.equal(isReclaimableLocalLock(dead, { host, pidAlive: () => true }), false);
  assert.equal(
    isReclaimableLocalLock({ holder: "other-machine:99999:aa" }, { host, pidAlive: () => false }),
    false,
  );
  assert.equal(
    isReclaimableLocalLock({ holder: `${host}:${process.pid}:aa` }, { host, pidAlive: () => false }),
    false,
    "our own pid is never treated as dead",
  );
});

test("release lock: holder ids parse into host/pid/nonce", () => {
  assert.deepEqual(parseLockHolder("mini.local:4242:ab12cd"), {
    host: "mini.local",
    pid: 4242,
    nonce: "ab12cd",
  });
});

test("release history: remote record maps failures to ok=0 and never throws", async (t) => {
  withEnv(t, { RELEASE_CONTROL_PLANE: null });
  const plane = createFakeControlPlane();
  const recorded = await recordRemoteReleaseHistory({
    entry: {
      source: "release-cloudflare",
      env: "production",
      sha: "abc",
      failure: "verify:cf:prod failed",
    },
    query: plane.query,
    logger: silent,
  });
  assert.equal(recorded, true);
  assert.equal(plane.history.length, 1);
  const [, , source, env, ok, sha] = plane.history[0];
  assert.equal(source, "release-cloudflare");
  assert.equal(env, "production");
  assert.equal(ok, 0);
  assert.equal(sha, "abc");

  const failed = await recordRemoteReleaseHistory({
    entry: { source: "x", env: "staging" },
    query: async () => {
      throw new Error("D1 unreachable");
    },
    logger: silent,
  });
  assert.equal(failed, false, "control-plane failures must not reject");
});
