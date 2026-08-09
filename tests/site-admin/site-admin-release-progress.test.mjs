import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSiteAdminReleaseProgress,
  selectActiveReleaseJob,
} from "../../lib/site-admin/release-progress.ts";

const NOW = Date.parse("2026-08-09T18:20:00.000Z");

function job(overrides = {}) {
  return {
    action: "publish-content-production",
    createdAt: NOW - 30_000,
    error: "",
    finishedAt: null,
    id: "job-active",
    phase: "queued",
    result: {},
    script: "publish:content:prod",
    startedAt: null,
    status: "queued",
    target: "production",
    updatedAt: NOW - 30_000,
    ...overrides,
  };
}

test("release progress: queued job with no heartbeat is explicit and has no absolute ETA", () => {
  const active = job();
  const progress = buildSiteAdminReleaseProgress({ job: active, jobs: [active], now: NOW });

  assert.equal(progress.stage, "queued");
  assert.equal(progress.indeterminate, true);
  assert.equal(progress.percent, null);
  assert.equal(progress.runnerState, "offline");
  assert.equal(progress.eta.earliestAt, null);
  assert.match(progress.detail, /No release runner heartbeat/);
});

test("release progress: queued job reports queue position and a low-confidence first-run window", () => {
  const ahead = job({ id: "job-ahead", createdAt: NOW - 60_000 });
  const active = job();
  const progress = buildSiteAdminReleaseProgress({
    job: active,
    jobs: [active, ahead],
    now: NOW,
    runners: [
      {
        agentId: "mac-mini",
        currentJobId: "",
        lastSeenAt: NOW - 10_000,
        status: "idle",
      },
    ],
  });

  assert.equal(progress.queuePosition, 2);
  assert.equal(progress.runnerState, "online");
  assert.equal(progress.eta.source, "baseline");
  assert.equal(progress.eta.confidence, "low");
  assert.ok(progress.eta.latestAt > progress.eta.earliestAt);
});

test("release progress: real checkpoints advance and successful history calibrates ETA", () => {
  const active = job({
    phase: "upload",
    startedAt: NOW - 90_000,
    status: "running",
    updatedAt: NOW - 1_000,
  });
  const history = [150_000, 180_000, 210_000, 240_000, 300_000].map(
    (duration, index) =>
      job({
        finishedAt: NOW - index * 10_000,
        id: `history-${index}`,
        phase: "complete",
        result: { durationMs: duration },
        startedAt: NOW - index * 10_000 - duration,
        status: "succeeded",
      }),
  );
  const progress = buildSiteAdminReleaseProgress({
    job: active,
    jobs: [active, ...history],
    now: NOW,
    runners: [
      {
        agentId: "mac-mini",
        currentJobId: active.id,
        lastSeenAt: NOW - 2_000,
        status: "running",
      },
    ],
  });

  assert.equal(progress.stage, "uploading");
  assert.equal(progress.percent, 84);
  assert.equal(progress.eta.source, "history");
  assert.equal(progress.eta.confidence, "high");
  assert.equal(progress.eta.sampleSize, 5);
});

test("release progress: running work takes precedence over a newer queued follow-up", () => {
  const running = job({ id: "running", status: "running", phase: "build" });
  const queued = job({ id: "follow-up", createdAt: NOW, updatedAt: NOW });
  assert.equal(selectActiveReleaseJob([queued, running])?.id, "running");
});

test("release progress: fresh job signals keep a running release online", () => {
  const active = job({
    status: "running",
    phase: "build",
    startedAt: NOW - 2 * 60_000,
    updatedAt: NOW - 2_000,
  });
  const progress = buildSiteAdminReleaseProgress({
    job: active,
    jobs: [active],
    now: NOW,
    runners: [],
  });

  assert.equal(progress.runnerState, "online");
  assert.equal(progress.stalled, false);
  assert.ok(progress.eta.latestAt);
});

test("release progress: ETA calibration uses the newest 20 matching runs", () => {
  const active = job({ status: "running", phase: "build", startedAt: NOW - 30_000 });
  const recent = Array.from({ length: 20 }, (_, index) =>
    job({
      id: `recent-${index}`,
      status: "succeeded",
      phase: "complete",
      result: { durationMs: 120_000 },
      finishedAt: NOW - index * 1_000,
    }),
  );
  const olderSlowRuns = Array.from({ length: 10 }, (_, index) =>
    job({
      id: `older-${index}`,
      status: "succeeded",
      phase: "complete",
      result: { durationMs: 12 * 60_000 },
      finishedAt: NOW - (index + 20) * 1_000,
    }),
  );

  const progress = buildSiteAdminReleaseProgress({
    job: active,
    jobs: [active, ...recent, ...olderSlowRuns],
    now: NOW,
    runners: [
      {
        agentId: "mac-mini",
        currentJobId: active.id,
        lastSeenAt: NOW,
        status: "running",
      },
    ],
  });

  assert.equal(progress.eta.sampleSize, 20);
  assert.equal(progress.eta.typicalMinMs, 120_000);
  assert.equal(progress.eta.typicalMaxMs, 120_000);
});
