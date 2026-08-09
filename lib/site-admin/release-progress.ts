export type SiteAdminReleaseJobLike = {
  id: string;
  action: string;
  script: string;
  target: "staging" | "production";
  status: string;
  phase: string;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number | null;
  startedAt?: number | null;
  finishedAt: number | null;
  result?: Record<string, unknown>;
  error: string;
};

export type SiteAdminReleaseRunnerLike = {
  agentId: string;
  status: "idle" | "running";
  currentJobId: string;
  lastSeenAt: number;
};

export type SiteAdminReleaseProgress = {
  stage:
    | "queued"
    | "preparing"
    | "syncing"
    | "snapshot"
    | "building"
    | "packaging"
    | "uploading"
    | "verifying"
    | "complete";
  label: string;
  detail: string;
  percent: number | null;
  indeterminate: boolean;
  step: number;
  stepCount: number;
  elapsedMs: number;
  lastSignalAt: number;
  queuePosition: number | null;
  runnerState: "online" | "busy" | "offline";
  stalled: boolean;
  eta: {
    source: "history" | "baseline" | "unavailable";
    confidence: "high" | "medium" | "low" | "none";
    sampleSize: number;
    earliestAt: number | null;
    latestAt: number | null;
    typicalMinMs: number | null;
    typicalMaxMs: number | null;
    overdue: boolean;
  };
};

type StageProjection = Pick<
  SiteAdminReleaseProgress,
  "stage" | "label" | "percent" | "indeterminate" | "step" | "stepCount"
>;

type DurationWindow = {
  source: "history" | "baseline" | "unavailable";
  confidence: "high" | "medium" | "low" | "none";
  sampleSize: number;
  minMs: number | null;
  maxMs: number | null;
};

const RUNNER_FRESH_MS = 90_000;
const RUNNING_SIGNAL_STALE_MS = 5 * 60_000;
const STEP_COUNT = 6;

const DEFAULT_DURATION_WINDOWS: Record<string, [number, number]> = {
  status: [5_000, 20_000],
  "runner-self-test": [30_000, 2 * 60_000],
  "publish-content-staging": [2 * 60_000, 6 * 60_000],
  "publish-content-production": [2 * 60_000, 6 * 60_000],
  "publish-content-production-from-staging": [60_000, 4 * 60_000],
  "publish-now-production-from-staging": [60_000, 4 * 60_000],
  "deploy-staging-code": [4 * 60_000, 12 * 60_000],
  "promote-production-code": [3 * 60_000, 10 * 60_000],
  "smart-release": [5 * 60_000, 15 * 60_000],
};

function finiteMs(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index] || 0;
}

function completedDuration(job: SiteAdminReleaseJobLike): number | null {
  const resultDuration = finiteMs(job.result?.durationMs);
  if (resultDuration) return resultDuration;
  const startedAt = finiteMs(job.startedAt);
  const finishedAt = finiteMs(job.finishedAt);
  if (!startedAt || !finishedAt || finishedAt <= startedAt) return null;
  return finishedAt - startedAt;
}

function durationWindow(
  job: SiteAdminReleaseJobLike,
  jobs: SiteAdminReleaseJobLike[],
): DurationWindow {
  const durations = jobs
    .filter(
      (candidate) =>
        candidate.id !== job.id &&
        candidate.action === job.action &&
        candidate.status === "succeeded",
    )
    // Callers provide jobs newest-first. Keep that recency signal before
    // sorting the duration values for percentile calculation.
    .slice(0, 20)
    .map(completedDuration)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  if (durations.length >= 3) {
    return {
      source: "history",
      confidence: durations.length >= 5 ? "high" : "medium",
      sampleSize: durations.length,
      minMs: percentile(durations, 0.5),
      maxMs: percentile(durations, 0.9),
    };
  }

  if (durations.length > 0) {
    return {
      source: "history",
      confidence: "low",
      sampleSize: durations.length,
      minMs: Math.max(1_000, Math.round(durations[0] * 0.8)),
      maxMs: Math.round(durations.at(-1)! * 1.5),
    };
  }

  const baseline = DEFAULT_DURATION_WINDOWS[job.action];
  if (!baseline) {
    return {
      source: "unavailable",
      confidence: "none",
      sampleSize: 0,
      minMs: null,
      maxMs: null,
    };
  }
  return {
    source: "baseline",
    confidence: "low",
    sampleSize: 0,
    minMs: baseline[0],
    maxMs: baseline[1],
  };
}

function stageProjection(job: SiteAdminReleaseJobLike): StageProjection {
  if (job.status === "queued") {
    return {
      stage: "queued",
      label: "Waiting for release runner",
      percent: null,
      indeterminate: true,
      step: 1,
      stepCount: STEP_COUNT,
    };
  }

  switch (job.phase.trim().toLowerCase()) {
    case "complete":
      return {
        stage: "complete",
        label: "Published successfully",
        percent: 100,
        indeterminate: false,
        step: 6,
        stepCount: STEP_COUNT,
      };
    case "verify":
    case "verifying":
      return {
        stage: "verifying",
        label: "Verifying the live site",
        percent: 94,
        indeterminate: false,
        step: 5,
        stepCount: STEP_COUNT,
      };
    case "upload":
    case "uploading":
      return {
        stage: "uploading",
        label: "Uploading changed pages",
        percent: 84,
        indeterminate: false,
        step: 4,
        stepCount: STEP_COUNT,
      };
    case "export":
    case "packaging":
      return {
        stage: "packaging",
        label: "Packaging public pages",
        percent: 68,
        indeterminate: false,
        step: 3,
        stepCount: STEP_COUNT,
      };
    case "build":
    case "building":
      return {
        stage: "building",
        label: "Building public pages",
        percent: 40,
        indeterminate: false,
        step: 3,
        stepCount: STEP_COUNT,
      };
    case "prepare-content":
    case "snapshot":
      return {
        stage: "snapshot",
        label: "Preparing the content snapshot",
        percent: 24,
        indeterminate: false,
        step: 2,
        stepCount: STEP_COUNT,
      };
    case "sync":
      return {
        stage: "syncing",
        label: "Syncing the release runner",
        percent: 16,
        indeterminate: false,
        step: 2,
        stepCount: STEP_COUNT,
      };
    case "claimed":
    case "starting":
    case "wake":
      return {
        stage: "preparing",
        label: "Preparing the release",
        percent: 8,
        indeterminate: false,
        step: 2,
        stepCount: STEP_COUNT,
      };
    default:
      return {
        stage: "building",
        label: job.action.startsWith("publish-content")
          ? "Publishing saved content"
          : "Running the release",
        percent: 32,
        indeterminate: false,
        step: 3,
        stepCount: STEP_COUNT,
      };
  }
}

export function selectActiveReleaseJob(
  jobs: SiteAdminReleaseJobLike[],
): SiteAdminReleaseJobLike | null {
  const running = jobs
    .filter((job) => job.status === "running")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (running) return running;
  return (
    jobs
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
  );
}

export function buildSiteAdminReleaseProgress(input: {
  job: SiteAdminReleaseJobLike;
  jobs?: SiteAdminReleaseJobLike[];
  runners?: SiteAdminReleaseRunnerLike[];
  now?: number;
}): SiteAdminReleaseProgress {
  const { job } = input;
  const jobs = input.jobs ?? [job];
  const runners = input.runners ?? [];
  const now = finiteMs(input.now) ?? Date.now();
  const stage = stageProjection(job);
  const jobSignalAt = finiteMs(job.updatedAt) ?? finiteMs(job.startedAt) ?? now;
  const jobSignalFresh =
    job.status === "running" && now - jobSignalAt <= RUNNING_SIGNAL_STALE_MS;
  const freshRunners = runners.filter(
    (runner) => runner.lastSeenAt > 0 && now - runner.lastSeenAt <= RUNNER_FRESH_MS,
  );
  const assignedRunner = freshRunners.find(
    (runner) => runner.currentJobId === job.id,
  );
  const idleRunner = freshRunners.find((runner) => runner.status === "idle");
  const runnerState: SiteAdminReleaseProgress["runnerState"] =
    assignedRunner || idleRunner || jobSignalFresh
      ? "online"
      : freshRunners.length > 0
        ? "busy"
        : "offline";
  const queuedJobs = jobs
    .filter((candidate) => candidate.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt);
  const queueIndex = queuedJobs.findIndex((candidate) => candidate.id === job.id);
  const queuePosition = job.status === "queued" && queueIndex >= 0 ? queueIndex + 1 : null;
  const startedAt = finiteMs(job.startedAt);
  const elapsedFrom = startedAt ?? finiteMs(job.createdAt) ?? now;
  const elapsedMs = Math.max(0, now - elapsedFrom);
  const lastSignalAt = finiteMs(job.updatedAt) ?? elapsedFrom;
  const stalled =
    job.status === "running" && now - lastSignalAt > RUNNING_SIGNAL_STALE_MS;
  const window = durationWindow(job, jobs);

  let earliestAt: number | null = null;
  let latestAt: number | null = null;
  let overdue = false;
  if (window.minMs !== null && window.maxMs !== null && runnerState !== "offline") {
    if (job.status === "queued") {
      const jobsAhead = Math.max(0, (queuePosition ?? 1) - 1);
      const busyDelay = runnerState === "busy" ? window.maxMs : 0;
      const queueDelay = jobsAhead * window.maxMs + busyDelay;
      earliestAt = now + queueDelay + window.minMs;
      latestAt = now + queueDelay + window.maxMs + RUNNER_FRESH_MS;
    } else {
      const estimateFrom = startedAt ?? now;
      earliestAt = estimateFrom + window.minMs;
      latestAt = estimateFrom + window.maxMs;
      overdue = now > latestAt;
      if (overdue) {
        earliestAt = null;
        latestAt = null;
      } else {
        earliestAt = Math.max(now, earliestAt);
        latestAt = Math.max(now, latestAt);
      }
    }
  }

  let detail = "Release job is active.";
  if (job.status === "queued" && runnerState === "offline") {
    detail = "No release runner heartbeat. The publish is safely queued and has not started.";
  } else if (job.status === "queued" && runnerState === "busy") {
    detail = `Runner online but busy${queuePosition ? ` · queue position ${queuePosition}` : ""}.`;
  } else if (job.status === "queued") {
    detail = `Runner online${queuePosition ? ` · queue position ${queuePosition}` : ""}.`;
  } else if (stalled) {
    detail = "No new release signal for over 5 minutes. Checking the runner.";
  } else if (overdue) {
    detail = "This release is taking longer than the recent completion window.";
  } else {
    detail = `Step ${stage.step} of ${stage.stepCount} · release signals are updating automatically.`;
  }

  return {
    ...stage,
    detail,
    elapsedMs,
    lastSignalAt,
    queuePosition,
    runnerState,
    stalled,
    eta: {
      source: window.source,
      confidence: window.confidence,
      sampleSize: window.sampleSize,
      earliestAt,
      latestAt,
      typicalMinMs: window.minMs,
      typicalMaxMs: window.maxMs,
      overdue,
    },
  };
}
