import test from "node:test";
import assert from "node:assert/strict";

import { wakeReleaseRunnerForJob } from "../../lib/server/release-runner-wake.ts";
import {
  isWakeAuthorized,
  normalizeWakePayload,
  wakeHealthPayload,
} from "../../scripts/release/release-agent.mjs";

const job = {
  action: "publish-content-staging",
  actor: "jinkun",
  agentId: "",
  claimedAt: null,
  createdAt: 1,
  error: "",
  finishedAt: null,
  id: "job-123",
  phase: "queued",
  request: {},
  result: {},
  script: "publish:content:staging",
  startedAt: null,
  status: "queued",
  target: "staging",
  updatedAt: 1,
};

test("release runner wake: skips when wake URL is not configured", async () => {
  const out = await wakeReleaseRunnerForJob(job, { env: {}, fetchImpl: async () => {
    throw new Error("should not fetch");
  } });
  assert.equal(out.configured, false);
  assert.equal(out.ok, false);
});

test("release runner wake: posts job id/action with bearer and Cloudflare Access headers", async () => {
  const calls = [];
  const out = await wakeReleaseRunnerForJob(job, {
    env: {
      RELEASE_RUNNER_CF_ACCESS_CLIENT_ID: "access-id",
      RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET: "access-secret",
      RELEASE_RUNNER_WAKE_TOKEN: "wake-token",
      RELEASE_RUNNER_WAKE_URL: "https://release-runner.example.com/",
    },
    fetchImpl: async (url, init) => {
      calls.push({ init, url });
      return Response.json({ ok: true }, { status: 202 });
    },
  });
  assert.equal(out.configured, true);
  assert.equal(out.ok, true);
  assert.equal(out.status, 202);
  assert.equal(calls[0].url, "https://release-runner.example.com/wake");
  assert.equal(calls[0].init.headers.Authorization, "Bearer wake-token");
  assert.equal(calls[0].init.headers["CF-Access-Client-Id"], "access-id");
  assert.equal(calls[0].init.headers["CF-Access-Client-Secret"], "access-secret");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "publish-content-staging",
    jobId: "job-123",
  });
});

test("release agent wake: validates token and allowlisted payloads", () => {
  assert.equal(isWakeAuthorized("", "secret-token"), false);
  assert.equal(isWakeAuthorized("Bearer wrong", "secret-token"), false);
  assert.equal(isWakeAuthorized("Bearer secret-token", "secret-token"), true);
  assert.deepEqual(normalizeWakePayload({ action: "rm -rf", jobId: "job-123" }), {
    error: "Unsupported release action.",
    ok: false,
    status: 400,
  });
  assert.deepEqual(normalizeWakePayload({ action: "status", jobId: "job-123" }), {
    action: "status",
    jobId: "job-123",
    ok: true,
  });
});

test("release agent health: hides runner details without wake token", () => {
  const snapshot = {
    agentId: "mac-mini:123",
    busy: true,
    currentAction: "status",
    currentJobId: "job-123",
    ok: true,
  };
  assert.deepEqual(wakeHealthPayload(snapshot, "", "secret-token"), { ok: true });
  assert.deepEqual(wakeHealthPayload(snapshot, "Bearer wrong", "secret-token"), { ok: true });
  assert.deepEqual(wakeHealthPayload(snapshot, "Bearer secret-token", "secret-token"), snapshot);
});
