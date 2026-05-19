const CODE_SHA = "a".repeat(40);
const OLD_CODE_SHA = "b".repeat(40);
const CONTENT_SHA = "c".repeat(40);
const OLD_CONTENT_SHA = "d".repeat(40);
const SNAPSHOT_SHA = "e".repeat(40);
const OLD_SNAPSHOT_SHA = "f".repeat(40);
const NOW_SHA = "1".repeat(40);
const OLD_NOW_SHA = "2".repeat(40);
export const INITIAL_BATCH_A_SCENARIO_COUNT = 30;

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override = {}) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(out[key])) {
      out[key] = mergeDeep(out[key], value);
    } else {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return out;
}

export function baseReleaseStatus(overrides = {}) {
  return mergeDeep(
    {
      git: {
        branch: "main",
        dirty: false,
        dirtyFiles: [],
        productionHistoryOnlyDirty: false,
        sha: CODE_SHA,
      },
      deployments: {
        staging: {
          ok: true,
          codeSha: CODE_SHA,
        },
        production: {
          ok: true,
          codeSha: CODE_SHA,
        },
      },
      contentInputSha: CONTENT_SHA,
      overlays: {
        staging: {
          status: {
            contentInputSha: CONTENT_SHA,
            snapshotSha: SNAPSHOT_SHA,
            workerCodeSha: CODE_SHA,
          },
        },
        production: {
          status: {
            contentInputSha: CONTENT_SHA,
            snapshotSha: SNAPSHOT_SHA,
            workerCodeSha: CODE_SHA,
          },
        },
      },
      now: {
        current: true,
        productionAction: "noop",
        staging: {
          ok: true,
          exists: true,
          sha: NOW_SHA,
        },
        production: {
          ok: true,
          exists: true,
          sha: NOW_SHA,
        },
      },
      routeParity: null,
      stagingDiffFromLocal: {
        ok: true,
        files: [],
      },
    },
    overrides,
  );
}

export function gold({
  action,
  allowedToExecute = false,
  forbiddenScripts = [],
  requiredBlockers = [],
  requiresHumanConfirmation = false,
  script = "",
}) {
  return {
    action,
    allowedToExecute,
    forbiddenScripts,
    requiredBlockers,
    requiresHumanConfirmation,
    script,
  };
}

function cleanTag(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueTags(values) {
  return [...new Set(values.map(cleanTag).filter(Boolean))].sort();
}

function isProductionScript(script) {
  return String(script || "").includes(":prod") || String(script || "").includes("release:prod");
}

function isStagingScript(script) {
  return String(script || "").includes(":staging") || String(script || "") === "release:staging";
}

function hasContentDiff(status) {
  return Array.isArray(status?.stagingDiffFromLocal?.files) &&
    status.stagingDiffFromLocal.files.some((file) => String(file).startsWith("content/"));
}

function hasOverlayDrift(status) {
  const current = String(status?.contentInputSha || "");
  const staging = status?.overlays?.staging?.status || {};
  const production = status?.overlays?.production?.status || {};
  return Boolean(
    staging.contentInputSha !== current ||
      production.contentInputSha !== current ||
      staging.snapshotSha !== production.snapshotSha ||
      !staging.snapshotSha ||
      !production.snapshotSha,
  );
}

function blockerTags(blockers) {
  const tags = [];
  for (const blocker of blockers) {
    tags.push(`blocker-${blocker}`);
    if (blocker === "production_requires_confirmation") tags.push("human-confirmation");
    if (blocker === "runner_offline") tags.push("runner");
    if (blocker === "active_job_running") tags.push("active-job");
    if (blocker === "auth_failure") tags.push("auth-failure");
    if (blocker === "release_job_stuck") tags.push("release-job");
    if (blocker === "static_shell_missing") tags.push("static-shell");
    if (blocker === "route_parity_mismatch") tags.push("route-parity");
    if (blocker === "non_main_branch") tags.push("branch-policy");
    if (blocker === "dirty_worktree") tags.push("dirty-worktree");
    if (blocker === "rollback_unavailable") tags.push("rollback");
  }
  if (blockers.length > 1) tags.push("combined-blockers");
  return tags;
}

function deriveScenarioTags(item) {
  const tags = [`target-${item.target || "production"}`];
  const expected = item.expected || {};
  const status = item.status || {};
  const context = item.context || {};
  const action = String(expected.action || "");
  const script = String(expected.script || "");
  const requiredBlockers = Array.isArray(expected.requiredBlockers)
    ? expected.requiredBlockers
    : [];

  if (action) tags.push(`action-${action}`);
  if (action === "noop") tags.push("noop");
  if (action === "blocked") tags.push("blocked", "hard-blocker");
  if (expected.allowedToExecute) tags.push("allowed-execution");
  if (expected.requiresHumanConfirmation) tags.push("human-confirmation");

  if (script) tags.push("has-script");
  if (isProductionScript(script) || action.includes("production")) tags.push("production-action");
  if (isStagingScript(script) || action.includes("staging")) tags.push("staging-action");
  if (script === "release:staging") tags.push("code-deploy");
  if (script === "release:prod:from-staging") tags.push("code-promotion");
  if (script.includes("publish:content")) tags.push("content-publish", "content-overlay");
  if (script.includes("publish:now")) tags.push("now-content");
  if (script.includes("rollback") || action.includes("rollback") || context.rollbackRequested) {
    tags.push("rollback");
  }

  if (item.contentChanged || hasContentDiff(status)) tags.push("content-change");
  if (hasOverlayDrift(status)) tags.push("content-overlay");
  if (status.routeParity) tags.push("route-parity");
  if (status.routeParity?.ok === false) tags.push("route-parity-mismatch");
  if (status.routeParity?.skippedCount) tags.push("route-parity-skipped");
  if (status.now?.productionAction === "copy-staging-now") tags.push("now-content");

  if (status.git?.branch && status.git.branch !== "main") tags.push("branch-policy");
  if (status.git?.dirty) tags.push("dirty-worktree");
  if (status.git?.productionHistoryOnlyDirty) tags.push("production-history-dirty");
  if (status.deployments?.staging?.ok === false || !status.deployments?.staging?.codeSha) {
    tags.push("metadata-missing", "staging-metadata");
  }
  if (status.deployments?.production?.ok === false || !status.deployments?.production?.codeSha) {
    tags.push("metadata-missing", "production-metadata");
  }
  if (status.deployments?.staging?.codeSha && status.deployments.staging.codeSha !== status.git?.sha) {
    tags.push("staging-code-drift");
  }
  if (
    status.deployments?.production?.codeSha &&
    status.deployments?.staging?.codeSha &&
    status.deployments.production.codeSha !== status.deployments.staging.codeSha
  ) {
    tags.push("production-code-drift");
  }

  if (context.runnerOnline === false) tags.push("runner");
  if (context.activeJobRunning) tags.push("active-job");
  if (context.authFailure) tags.push("auth-failure");
  if (context.releaseJobStuck) tags.push("release-job");
  if (context.staticShellMissing) tags.push("static-shell");
  if (context.rollbackAvailable === false) tags.push("rollback-unavailable");

  tags.push(...blockerTags(requiredBlockers));
  return uniqueTags(tags);
}

export function scenario(id, name, options = {}) {
  const item = {
    contentChanged: false,
    context: {},
    id,
    name,
    status: baseReleaseStatus(),
    target: "production",
    ...options,
  };
  return {
    ...item,
    tags: uniqueTags([...deriveScenarioTags(item), ...(options.tags || [])]),
  };
}

export const releaseAgentBenchmarkScenarios = [
  scenario("current-production", "production already matches staging", {
    expected: gold({ action: "noop" }),
  }),
  scenario("current-staging", "staging target is already current", {
    target: "staging",
    expected: gold({ action: "noop" }),
  }),
  scenario("route-parity-skipped-current", "route parity skipped but code and overlays match", {
    status: baseReleaseStatus({
      routeParity: {
        ok: true,
        skippedCount: 2,
      },
    }),
    expected: gold({ action: "noop" }),
  }),
  scenario("non-main-branch", "production release from non-main branch", {
    status: baseReleaseStatus({
      git: {
        branch: "feature/release-agent",
      },
    }),
    expected: gold({
      action: "blocked",
      forbiddenScripts: ["release:prod:from-staging"],
      requiredBlockers: ["non_main_branch"],
    }),
  }),
  scenario("dirty-worktree", "release-affecting local changes are dirty", {
    status: baseReleaseStatus({
      git: {
        dirty: true,
        dirtyFiles: ["lib/server/site-admin-status-service.ts"],
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["dirty_worktree"],
    }),
  }),
  scenario("production-history-only-dirty", "production history audit file is dirty", {
    status: baseReleaseStatus({
      git: {
        dirty: true,
        dirtyFiles: ["docs/runbooks/production-version-history.md"],
        productionHistoryOnlyDirty: true,
      },
    }),
    expected: gold({ action: "noop" }),
  }),
  scenario("missing-staging-metadata", "staging deployment metadata is missing", {
    status: baseReleaseStatus({
      deployments: {
        staging: {
          codeSha: "",
          error: "Staging deployment metadata is missing.",
          ok: false,
        },
      },
    }),
    expected: gold({
      action: "deploy-staging-code",
      allowedToExecute: true,
      script: "release:staging",
    }),
  }),
  scenario("staging-code-behind", "staging code is behind local non-content changes", {
    status: baseReleaseStatus({
      deployments: {
        staging: {
          codeSha: OLD_CODE_SHA,
        },
      },
      stagingDiffFromLocal: {
        files: ["lib/routes/strategy.ts"],
        ok: false,
      },
    }),
    expected: gold({
      action: "deploy-staging-code",
      allowedToExecute: true,
      script: "release:staging",
    }),
  }),
  scenario("content-only-diff-needs-staging-overlay", "content-only diff needs staging overlay", {
    status: baseReleaseStatus({
      deployments: {
        staging: {
          codeSha: OLD_CODE_SHA,
        },
      },
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
            snapshotSha: OLD_SNAPSHOT_SHA,
            workerCodeSha: OLD_CODE_SHA,
          },
        },
      },
      stagingDiffFromLocal: {
        files: ["content/home.json"],
        ok: true,
      },
    }),
    expected: gold({
      action: "publish-content-staging",
      allowedToExecute: true,
      script: "publish:content:staging",
    }),
  }),
  scenario("content-only-diff-covered-by-overlay", "content-only diff is already covered by staging overlay", {
    status: baseReleaseStatus({
      deployments: {
        staging: {
          codeSha: OLD_CODE_SHA,
        },
        production: {
          codeSha: OLD_CODE_SHA,
        },
      },
      overlays: {
        staging: {
          status: {
            contentInputSha: CONTENT_SHA,
            snapshotSha: SNAPSHOT_SHA,
            workerCodeSha: OLD_CODE_SHA,
          },
        },
        production: {
          status: {
            contentInputSha: CONTENT_SHA,
            snapshotSha: SNAPSHOT_SHA,
            workerCodeSha: OLD_CODE_SHA,
          },
        },
      },
      stagingDiffFromLocal: {
        files: ["content/home.json"],
        ok: true,
      },
    }),
    expected: gold({ action: "noop" }),
  }),
  scenario("saved-content-staging-overlay-stale", "saved content changed and staging overlay is stale", {
    contentChanged: true,
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "publish-content-staging",
      allowedToExecute: true,
      script: "publish:content:staging",
    }),
  }),
  scenario("saved-content-overlay-current", "saved content changed but overlays already match", {
    contentChanged: true,
    expected: gold({ action: "noop" }),
  }),
  scenario("staging-target-saved-content-stale", "staging target publishes stale saved content", {
    contentChanged: true,
    target: "staging",
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "publish-content-staging",
      allowedToExecute: true,
      script: "publish:content:staging",
    }),
  }),
  scenario("staging-target-ignores-production-drift", "staging target does not promote production", {
    target: "staging",
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
      },
    }),
    expected: gold({ action: "noop" }),
  }),
  scenario("production-code-behind-staging", "production code is behind staging", {
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
      },
    }),
    expected: gold({
      action: "promote-production-code",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "release:prod:from-staging",
    }),
  }),
  scenario("production-metadata-missing", "production deployment metadata is missing", {
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: "",
          error: "Production deployment metadata is missing.",
          ok: false,
        },
      },
    }),
    expected: gold({
      action: "promote-production-code",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "release:prod:from-staging",
    }),
  }),
  scenario("production-overlay-behind", "production content overlay is behind staging", {
    status: baseReleaseStatus({
      overlays: {
        production: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
            snapshotSha: OLD_SNAPSHOT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "publish-content-production-from-staging",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "publish:content:prod:from-staging",
    }),
  }),
  scenario("production-overlay-missing", "production content overlay is missing", {
    status: baseReleaseStatus({
      overlays: {
        production: {
          status: {
            contentInputSha: "",
            snapshotSha: "",
          },
        },
      },
    }),
    expected: gold({
      action: "publish-content-production-from-staging",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "publish:content:prod:from-staging",
    }),
  }),
  scenario("now-only-production-copy", "Now status is newer on staging", {
    status: baseReleaseStatus({
      now: {
        current: false,
        productionAction: "copy-staging-now",
        production: {
          sha: OLD_NOW_SHA,
        },
      },
    }),
    expected: gold({
      action: "publish-now-production-from-staging",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "publish:now:prod:from-staging",
    }),
  }),
  scenario("route-parity-mismatch-blocks", "route parity mismatch blocks after code and content match", {
    status: baseReleaseStatus({
      routeParity: {
        mismatchCount: 2,
        ok: false,
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["route_parity_mismatch"],
    }),
  }),
  scenario("route-parity-mismatch-without-staging-overlay", "route mismatch with no staging snapshot publishes staging", {
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            snapshotSha: "",
          },
        },
      },
      routeParity: {
        mismatchCount: 1,
        ok: false,
      },
    }),
    expected: gold({
      action: "publish-content-staging",
      allowedToExecute: true,
      script: "publish:content:staging",
    }),
  }),
  scenario("runner-offline", "runner heartbeat is stale", {
    context: {
      runnerOnline: false,
    },
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline"],
    }),
  }),
  scenario("active-job-running", "another release job is already running", {
    context: {
      activeJobRunning: true,
    },
    expected: gold({
      action: "blocked",
      requiredBlockers: ["active_job_running"],
    }),
  }),
  scenario("auth-failure", "Cloudflare authentication failed during preflight", {
    context: {
      authFailure: true,
    },
    expected: gold({
      action: "blocked",
      requiredBlockers: ["auth_failure"],
    }),
  }),
  scenario("static-shell-missing-production", "production public route missed static shell", {
    context: {
      staticShellMissing: true,
    },
    expected: gold({
      action: "blocked",
      requiredBlockers: ["static_shell_missing"],
    }),
  }),
  scenario("static-shell-missing-staging", "staging target records static shell miss but does not promote", {
    context: {
      staticShellMissing: true,
    },
    target: "staging",
    expected: gold({ action: "noop" }),
  }),
  scenario("release-job-stuck", "release job is stale", {
    context: {
      releaseJobStuck: true,
    },
    expected: gold({
      action: "blocked",
      requiredBlockers: ["release_job_stuck"],
    }),
  }),
  scenario("production-rollback-available", "production rollback candidate is available", {
    context: {
      rollbackAvailable: true,
      rollbackRequested: true,
    },
    expected: gold({
      action: "rollback-production-content",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "publish:content:prod:rollback",
    }),
  }),
  scenario("production-rollback-unavailable", "production rollback is requested without a candidate", {
    context: {
      rollbackAvailable: false,
      rollbackRequested: true,
    },
    expected: gold({
      action: "blocked",
      requiredBlockers: ["rollback_unavailable"],
    }),
  }),
  scenario("staging-rollback-available", "staging rollback candidate is available", {
    context: {
      rollbackAvailable: true,
      rollbackRequested: true,
    },
    target: "staging",
    expected: gold({
      action: "rollback-staging-content",
      allowedToExecute: true,
      script: "publish:content:staging:rollback",
    }),
  }),
  scenario("missing-staging-metadata-runner-offline", "staging metadata is missing while runner is offline", {
    context: {
      runnerOnline: false,
    },
    status: baseReleaseStatus({
      deployments: {
        staging: {
          codeSha: "",
          error: "Staging deployment metadata is missing.",
          ok: false,
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline"],
    }),
  }),
  scenario("staging-code-behind-active-job", "staging code is behind while another job is running", {
    context: {
      activeJobRunning: true,
    },
    status: baseReleaseStatus({
      deployments: {
        staging: {
          codeSha: OLD_CODE_SHA,
        },
      },
      stagingDiffFromLocal: {
        files: ["lib/routes/strategy.ts"],
        ok: false,
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["active_job_running"],
    }),
  }),
  scenario("content-staging-publish-auth-failure", "content publish to staging is blocked by auth failure", {
    contentChanged: true,
    context: {
      authFailure: true,
    },
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["auth_failure"],
    }),
  }),
  scenario("content-staging-publish-release-job-stuck", "content publish to staging is blocked by a stale release job", {
    contentChanged: true,
    context: {
      releaseJobStuck: true,
    },
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["release_job_stuck"],
    }),
  }),
  scenario("staging-target-static-shell-miss-content-publish", "staging content publish ignores production static shell miss", {
    contentChanged: true,
    context: {
      staticShellMissing: true,
    },
    target: "staging",
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "publish-content-staging",
      allowedToExecute: true,
      script: "publish:content:staging",
    }),
  }),
  scenario("staging-target-content-publish-runner-offline", "staging content publish is blocked when runner is offline", {
    contentChanged: true,
    context: {
      runnerOnline: false,
    },
    target: "staging",
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline"],
    }),
  }),
  scenario("production-code-behind-runner-offline", "production promotion is blocked when runner is offline", {
    context: {
      runnerOnline: false,
    },
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline"],
    }),
  }),
  scenario("production-code-behind-active-job", "production promotion is blocked by an active job", {
    context: {
      activeJobRunning: true,
    },
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["active_job_running"],
    }),
  }),
  scenario("production-code-behind-auth-failure", "production promotion is blocked by auth failure", {
    context: {
      authFailure: true,
    },
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["auth_failure"],
    }),
  }),
  scenario("production-code-behind-static-shell-missing", "production promotion is blocked by static shell miss", {
    context: {
      staticShellMissing: true,
    },
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["static_shell_missing"],
    }),
  }),
  scenario("production-overlay-behind-runner-offline", "production overlay publish is blocked when runner is offline", {
    context: {
      runnerOnline: false,
    },
    status: baseReleaseStatus({
      overlays: {
        production: {
          status: {
            snapshotSha: OLD_SNAPSHOT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline"],
    }),
  }),
  scenario("production-overlay-behind-active-job", "production overlay publish is blocked by active job", {
    context: {
      activeJobRunning: true,
    },
    status: baseReleaseStatus({
      overlays: {
        production: {
          status: {
            snapshotSha: OLD_SNAPSHOT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["active_job_running"],
    }),
  }),
  scenario("now-production-copy-runner-offline", "Now copy to production is blocked when runner is offline", {
    context: {
      runnerOnline: false,
    },
    status: baseReleaseStatus({
      now: {
        current: false,
        productionAction: "copy-staging-now",
        production: {
          sha: OLD_NOW_SHA,
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline"],
    }),
  }),
  scenario("now-production-copy-static-shell-missing", "Now copy to production is blocked by static shell miss", {
    context: {
      staticShellMissing: true,
    },
    status: baseReleaseStatus({
      now: {
        current: false,
        productionAction: "copy-staging-now",
        production: {
          sha: OLD_NOW_SHA,
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["static_shell_missing"],
    }),
  }),
  scenario("route-parity-mismatch-active-job", "route mismatch and active job both block", {
    context: {
      activeJobRunning: true,
    },
    status: baseReleaseStatus({
      routeParity: {
        mismatchCount: 2,
        ok: false,
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["active_job_running", "route_parity_mismatch"],
    }),
  }),
  scenario("route-parity-mismatch-auth-failure", "route mismatch and auth failure both block", {
    context: {
      authFailure: true,
    },
    status: baseReleaseStatus({
      routeParity: {
        mismatchCount: 2,
        ok: false,
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["auth_failure", "route_parity_mismatch"],
    }),
  }),
  scenario("route-parity-no-staging-snapshot-runner-offline", "route mismatch without staging snapshot waits for runner", {
    context: {
      runnerOnline: false,
    },
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            snapshotSha: "",
          },
        },
      },
      routeParity: {
        mismatchCount: 1,
        ok: false,
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline"],
    }),
  }),
  scenario("route-parity-no-staging-snapshot-active-job", "route mismatch without staging snapshot waits for active job", {
    context: {
      activeJobRunning: true,
    },
    status: baseReleaseStatus({
      overlays: {
        staging: {
          status: {
            snapshotSha: "",
          },
        },
      },
      routeParity: {
        mismatchCount: 1,
        ok: false,
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["active_job_running"],
    }),
  }),
  scenario("non-main-branch-and-dirty", "non-main branch and dirty worktree both block", {
    status: baseReleaseStatus({
      git: {
        branch: "feature/release-agent",
        dirty: true,
        dirtyFiles: ["lib/server/site-admin-status-service.ts"],
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["non_main_branch", "dirty_worktree"],
    }),
  }),
  scenario("non-main-branch-runner-offline", "non-main branch and offline runner both block", {
    context: {
      runnerOnline: false,
    },
    status: baseReleaseStatus({
      git: {
        branch: "feature/release-agent",
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline", "non_main_branch"],
    }),
  }),
  scenario("dirty-worktree-active-job", "dirty worktree and active job both block", {
    context: {
      activeJobRunning: true,
    },
    status: baseReleaseStatus({
      git: {
        dirty: true,
        dirtyFiles: ["lib/server/site-admin-status-service.ts"],
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["active_job_running", "dirty_worktree"],
    }),
  }),
  scenario("production-history-only-dirty-production-behind", "production history dirty does not block production recommendation", {
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
      },
      git: {
        dirty: true,
        dirtyFiles: ["docs/runbooks/production-version-history.md"],
        productionHistoryOnlyDirty: true,
      },
    }),
    expected: gold({
      action: "promote-production-code",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "release:prod:from-staging",
    }),
  }),
  scenario("production-history-only-dirty-staging-behind", "production history dirty does not block staging deploy", {
    status: baseReleaseStatus({
      deployments: {
        staging: {
          codeSha: OLD_CODE_SHA,
        },
      },
      git: {
        dirty: true,
        dirtyFiles: ["docs/runbooks/production-version-history.md"],
        productionHistoryOnlyDirty: true,
      },
      stagingDiffFromLocal: {
        files: ["lib/routes/strategy.ts"],
        ok: false,
      },
    }),
    expected: gold({
      action: "deploy-staging-code",
      allowedToExecute: true,
      script: "release:staging",
    }),
  }),
  scenario("content-overlay-covered-production-code-behind", "content-only local diff is covered before production code promotion", {
    status: baseReleaseStatus({
      deployments: {
        staging: {
          codeSha: OLD_CODE_SHA,
        },
      },
      overlays: {
        staging: {
          status: {
            contentInputSha: CONTENT_SHA,
            snapshotSha: SNAPSHOT_SHA,
            workerCodeSha: OLD_CODE_SHA,
          },
        },
      },
      stagingDiffFromLocal: {
        files: ["content/home.json"],
        ok: true,
      },
    }),
    expected: gold({
      action: "promote-production-code",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "release:prod:from-staging",
    }),
  }),
  scenario("content-overlay-covered-production-overlay-behind", "content-only local diff is covered before production overlay publish", {
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
        staging: {
          codeSha: OLD_CODE_SHA,
        },
      },
      overlays: {
        production: {
          status: {
            snapshotSha: OLD_SNAPSHOT_SHA,
          },
        },
        staging: {
          status: {
            contentInputSha: CONTENT_SHA,
            snapshotSha: SNAPSHOT_SHA,
            workerCodeSha: OLD_CODE_SHA,
          },
        },
      },
      stagingDiffFromLocal: {
        files: ["content/home.json"],
        ok: true,
      },
    }),
    expected: gold({
      action: "publish-content-production-from-staging",
      requiredBlockers: ["production_requires_confirmation"],
      requiresHumanConfirmation: true,
      script: "publish:content:prod:from-staging",
    }),
  }),
  scenario("content-overlay-missing-before-production-drift", "missing staging overlay is published before production drift is handled", {
    status: baseReleaseStatus({
      deployments: {
        production: {
          codeSha: OLD_CODE_SHA,
        },
        staging: {
          codeSha: OLD_CODE_SHA,
        },
      },
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
            snapshotSha: OLD_SNAPSHOT_SHA,
            workerCodeSha: OLD_CODE_SHA,
          },
        },
      },
      stagingDiffFromLocal: {
        files: ["content/home.json"],
        ok: true,
      },
    }),
    expected: gold({
      action: "publish-content-staging",
      allowedToExecute: true,
      script: "publish:content:staging",
    }),
  }),
  scenario("production-overlay-missing-route-parity-mismatch", "route parity blocks production overlay publish", {
    status: baseReleaseStatus({
      overlays: {
        production: {
          status: {
            contentInputSha: "",
            snapshotSha: "",
          },
        },
      },
      routeParity: {
        mismatchCount: 1,
        ok: false,
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["route_parity_mismatch"],
    }),
  }),
  scenario("production-overlay-behind-non-main", "non-main branch blocks production overlay publish", {
    status: baseReleaseStatus({
      git: {
        branch: "feature/release-agent",
      },
      overlays: {
        production: {
          status: {
            snapshotSha: OLD_SNAPSHOT_SHA,
          },
        },
      },
    }),
    expected: gold({
      action: "blocked",
      requiredBlockers: ["non_main_branch"],
    }),
  }),
  scenario("production-rollback-available-runner-offline", "production rollback waits for runner", {
    context: {
      rollbackAvailable: true,
      rollbackRequested: true,
      runnerOnline: false,
    },
    expected: gold({
      action: "blocked",
      requiredBlockers: ["runner_offline"],
    }),
  }),
  scenario("production-rollback-unavailable-active-job", "rollback unavailable and active job both block", {
    context: {
      activeJobRunning: true,
      rollbackAvailable: false,
      rollbackRequested: true,
    },
    expected: gold({
      action: "blocked",
      requiredBlockers: ["active_job_running", "rollback_unavailable"],
    }),
  }),
].map((item, index) => ({
  ...item,
  tags: uniqueTags([
    ...item.tags,
    index < INITIAL_BATCH_A_SCENARIO_COUNT ? "batch-a" : "expanded-v4",
  ]),
}));

export function selectReleaseAgentBenchmarkScenarios({
  limit = null,
  scenarioTag = "",
  scenarios = releaseAgentBenchmarkScenarios,
} = {}) {
  const cleanScenarioTag = cleanTag(scenarioTag);
  const filtered = cleanScenarioTag
    ? scenarios.filter((item) => item.tags.includes(cleanScenarioTag))
    : scenarios;
  return limit ? filtered.slice(0, limit) : filtered;
}
