// P0-7: a job the control plane had already closed out kept deploying. The
// runner only watched for status 'canceled', so a job the API declared stale
// (status='failed' after 45 minutes) ran to completion against production
// while the operator was already clicking Retry.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  createRunnerController,
  releaseJobAbortStatus,
  runCommand,
} from "../../scripts/release/release-agent.mjs";

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.signals = [];
  proc.kill = (signal) => {
    proc.signals.push(signal);
    // Real npm exits on SIGTERM; mirror that so the promise settles.
    setImmediate(() => proc.emit("exit", null));
    return true;
  };
  return proc;
}

test("release agent: every terminal status is an abort signal", () => {
  for (const status of ["canceled", "failed", "succeeded"]) {
    assert.equal(releaseJobAbortStatus({ data: { job: { status } } }), status);
  }
  for (const status of ["queued", "running", "", undefined]) {
    assert.equal(releaseJobAbortStatus({ data: { job: { status } } }), "");
  }
  assert.equal(releaseJobAbortStatus({ job: { status: "failed" } }), "failed");
  assert.equal(releaseJobAbortStatus(null), "");
  assert.equal(releaseJobAbortStatus({}), "");
});

test("release agent: a job marked stale stops the running command", async () => {
  const proc = fakeProcess();
  const lines = [];
  const result = await runCommand({
    action: "publish-content-staging",
    abortStatus: async () => "failed",
    onLine: (stream, line) => lines.push(`${stream}: ${line}`),
    repo: process.cwd(),
    spawnImpl: () => proc,
  });

  assert.equal(result.aborted, "failed");
  assert.equal(result.code, 130);
  assert.deepEqual(proc.signals, ["SIGTERM"]);
  assert.ok(lines.some((line) => line.includes("Release job is failed; terminating")));
});

// The API-side busy guard only helps when claims arrive one at a time. The
// poll loop and a wake request overlap freely, and `currentJobId` is not set
// until a claim resolves — so without a gate one runner takes two jobs and
// deploys them over each other.
test("release agent: overlapping claims never start two jobs at once", async () => {
  const handed = [];
  const running = [];
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const controller = createRunnerController({
    agentId: "mac-mini",
    baseUrl: "https://staging.example",
    claimImpl: async () => {
      // Both claims are in flight before either resolves.
      await new Promise((resolve) => setImmediate(resolve));
      const job = { action: "deploy-staging-code", id: `job-${handed.length + 1}` };
      handed.push(job.id);
      return job;
    },
    repo: process.cwd(),
    runJobImpl: async ({ job }) => {
      running.push(job.id);
      await blocked;
      return true;
    },
    token: "t",
  });

  const first = controller.drainNextJob();
  const second = controller.drainNextJob();
  const wake = controller.startPreferredJob({
    action: "deploy-staging-code",
    jobId: "job-9",
  });
  assert.deepEqual(await wake, {
    error: "Runner is busy with job-1.",
    ok: false,
    status: 409,
  });
  assert.equal(await second, false, "the second poll must not claim while busy");
  assert.deepEqual(running, ["job-1"]);
  assert.deepEqual(handed, ["job-1"], "a second job must not be pulled off the queue");

  release();
  assert.equal(await first, true);
  assert.equal(controller.snapshot().busy, false);
});

test("release agent: a still-running job is left alone", async () => {
  const proc = fakeProcess();
  const pending = runCommand({
    action: "publish-content-staging",
    abortStatus: async () => "",
    onLine: () => {},
    repo: process.cwd(),
    spawnImpl: () => proc,
  });
  setImmediate(() => proc.emit("exit", 0));
  const result = await pending;

  assert.equal(result.aborted, "");
  assert.equal(result.code, 0);
  assert.deepEqual(proc.signals, []);
});
