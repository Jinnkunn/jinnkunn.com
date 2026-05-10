import test from "node:test";
import assert from "node:assert/strict";

import { createClient } from "@libsql/client";

import {
  appendReleaseJobEvent,
  claimReleaseJob,
  completeReleaseJob,
  createReleaseJob,
  ensureReleaseJobTables,
  getReleaseRunnerStatus,
  heartbeatReleaseAgent,
  listReleaseJobActions,
  listReleaseJobs,
  releaseJobCommand,
} from "../lib/server/release-jobs-service.ts";

async function makeExecutor() {
  const client = createClient({ url: ":memory:" });
  await ensureReleaseJobTables(client);
  return client;
}

test("release jobs: exposes only explicit release agent actions", () => {
  const actions = listReleaseJobActions().map((item) => item.action).sort();
  assert.deepEqual(actions, [
    "deploy-staging-code",
    "promote-production-code",
    "publish-content-production-from-staging",
    "publish-content-staging",
    "smart-release",
    "status",
  ]);
  assert.deepEqual(releaseJobCommand("status").args, [
    "run",
    "release:status:json",
    "--",
    "--skip-routes",
  ]);
});

test("release jobs: create, claim, append events, and complete", async () => {
  const executor = await makeExecutor();
  const created = await createReleaseJob({
    action: "publish-content-staging",
    actor: "jinkun",
    request: { source: "test" },
    executor,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.error);
  assert.equal(created.data.status, "queued");
  assert.equal(created.data.script, "publish:content:staging");
  assert.equal(created.data.target, "staging");

  const claimed = await claimReleaseJob({
    agentId: "mac-mini",
    capabilities: ["publish-content-staging"],
    executor,
  });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) throw new Error(claimed.error);
  assert.equal(claimed.data.job?.id, created.data.id);
  assert.equal(claimed.data.job?.status, "running");
  assert.equal(claimed.data.command?.npmScript, "publish:content:staging");

  const event = await appendReleaseJobEvent({
    id: created.data.id,
    phase: "build",
    stream: "stdout",
    message: "hello",
    executor,
  });
  assert.equal(event.ok, true);
  if (!event.ok) throw new Error(event.error);
  assert.equal(event.data.seq, 2);

  const completed = await completeReleaseJob({
    id: created.data.id,
    status: "succeeded",
    result: { exitCode: 0 },
    executor,
  });
  assert.equal(completed.ok, true);
  if (!completed.ok) throw new Error(completed.error);
  assert.equal(completed.data.status, "succeeded");
  assert.equal(completed.data.result.exitCode, 0);

  const listed = await listReleaseJobs({ executor });
  assert.equal(listed.ok, true);
  if (!listed.ok) throw new Error(listed.error);
  assert.equal(listed.data.jobs.length, 1);
  assert.equal(listed.data.jobs[0].status, "succeeded");
});

test("release jobs: unsupported actions are rejected and capabilities filter claims", async () => {
  const executor = await makeExecutor();
  const rejected = await createReleaseJob({
    action: "release:prod",
    actor: "jinkun",
    executor,
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) throw new Error("expected rejection");
  assert.equal(rejected.code, "BAD_REQUEST");

  const created = await createReleaseJob({
    action: "deploy-staging-code",
    actor: "jinkun",
    executor,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.error);

  const skipped = await claimReleaseJob({
    agentId: "mac-mini",
    capabilities: ["status"],
    executor,
  });
  assert.equal(skipped.ok, true);
  if (!skipped.ok) throw new Error(skipped.error);
  assert.equal(skipped.data.job, null);
});

test("release jobs: tracks runner heartbeat and queue summary", async () => {
  const executor = await makeExecutor();
  const heartbeat = await heartbeatReleaseAgent({
    agentId: "mac-mini",
    capabilities: ["publish-content-staging", "deploy-staging-code"],
    status: "idle",
    executor,
  });
  assert.equal(heartbeat.ok, true);
  if (!heartbeat.ok) throw new Error(heartbeat.error);
  assert.equal(heartbeat.data.agentId, "mac-mini");
  assert.equal(heartbeat.data.status, "idle");
  assert.deepEqual(heartbeat.data.capabilities, [
    "publish-content-staging",
    "deploy-staging-code",
  ]);

  const created = await createReleaseJob({
    action: "publish-content-staging",
    actor: "jinkun",
    executor,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.error);

  const queuedSummary = await getReleaseRunnerStatus({ executor });
  assert.equal(queuedSummary.ok, true);
  if (!queuedSummary.ok) throw new Error(queuedSummary.error);
  assert.equal(queuedSummary.data.queuedCount, 1);
  assert.equal(queuedSummary.data.runningCount, 0);
  assert.equal(queuedSummary.data.agents[0].status, "idle");

  const claimed = await claimReleaseJob({
    agentId: "mac-mini",
    capabilities: ["publish-content-staging"],
    executor,
  });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) throw new Error(claimed.error);
  assert.equal(claimed.data.job?.id, created.data.id);

  const runningSummary = await getReleaseRunnerStatus({ executor });
  assert.equal(runningSummary.ok, true);
  if (!runningSummary.ok) throw new Error(runningSummary.error);
  assert.equal(runningSummary.data.queuedCount, 0);
  assert.equal(runningSummary.data.runningCount, 1);
  assert.equal(runningSummary.data.agents[0].status, "running");
  assert.equal(runningSummary.data.agents[0].currentJobId, created.data.id);

  const completed = await completeReleaseJob({
    agentId: "mac-mini",
    id: created.data.id,
    status: "succeeded",
    executor,
  });
  assert.equal(completed.ok, true);
  if (!completed.ok) throw new Error(completed.error);

  const completedSummary = await getReleaseRunnerStatus({ executor });
  assert.equal(completedSummary.ok, true);
  if (!completedSummary.ok) throw new Error(completedSummary.error);
  assert.equal(completedSummary.data.runningCount, 0);
  assert.equal(completedSummary.data.agents[0].status, "idle");
  assert.equal(completedSummary.data.agents[0].currentJobId, "");
});
