import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContentPreview,
  deriveLiveReleasePlan,
} from "../../scripts/_lib/release-live-status.mjs";

const CODE_SHA = "a".repeat(40);
const CONTENT_SHA = "b".repeat(40);
const OLD_CONTENT_SHA = "c".repeat(40);
const LOCAL_SHA = "d".repeat(40);
const STAGING_SNAPSHOT = "e".repeat(40);
const PRODUCTION_SNAPSHOT = "f".repeat(40);
const NOW_SHA = "1".repeat(40);
const OLD_NOW_SHA = "2".repeat(40);

function statusFixture(overrides = {}) {
  return {
    git: {
      branch: "main",
      dirty: false,
      productionHistoryOnlyDirty: false,
      sha: LOCAL_SHA,
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
          snapshotSha: STAGING_SNAPSHOT,
          workerCodeSha: CODE_SHA,
        },
      },
      production: {
        status: {
          contentInputSha: OLD_CONTENT_SHA,
          snapshotSha: PRODUCTION_SNAPSHOT,
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
    stagingDiffFromLocal: {
      ok: true,
      files: ["content/home.json"],
    },
    routeParity: null,
    ...overrides,
  };
}

test("release live status: content-only HEAD after staging publish advances to production overlay copy", () => {
  const plan = deriveLiveReleasePlan({
    status: statusFixture(),
    target: "production",
    contentChanged: true,
  });

  assert.equal(plan.kind, "publish-content-production-from-staging");
  assert.equal(plan.script, "publish:content:prod:from-staging");
});

test("release live status: Now-only change publishes one D1 row to production", () => {
  const plan = deriveLiveReleasePlan({
    status: statusFixture({
      overlays: {
        staging: {
          status: {
            contentInputSha: CONTENT_SHA,
            snapshotSha: STAGING_SNAPSHOT,
            workerCodeSha: CODE_SHA,
          },
        },
        production: {
          status: {
            contentInputSha: CONTENT_SHA,
            snapshotSha: STAGING_SNAPSHOT,
            workerCodeSha: CODE_SHA,
          },
        },
      },
      now: {
        current: false,
        productionAction: "copy-staging-now",
        staging: {
          ok: true,
          exists: true,
          sha: NOW_SHA,
        },
        production: {
          ok: true,
          exists: true,
          sha: OLD_NOW_SHA,
        },
      },
    }),
    target: "production",
  });

  assert.equal(plan.kind, "publish-now-production-from-staging");
  assert.equal(plan.script, "publish:now:prod:from-staging");
});

test("release live status: content-only HEAD still publishes staging when overlay is stale", () => {
  const plan = deriveLiveReleasePlan({
    status: statusFixture({
      overlays: {
        staging: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
            snapshotSha: STAGING_SNAPSHOT,
            workerCodeSha: CODE_SHA,
          },
        },
        production: {
          status: {
            contentInputSha: OLD_CONTENT_SHA,
            snapshotSha: PRODUCTION_SNAPSHOT,
            workerCodeSha: CODE_SHA,
          },
        },
      },
    }),
    target: "production",
    contentChanged: true,
  });

  assert.equal(plan.kind, "publish-content-staging");
  assert.equal(plan.script, "publish:content:staging");
});

test("release live status: content preview treats cleared overlays as current after full deploy", () => {
  const preview = buildContentPreview({
    contentInputSha: CONTENT_SHA,
    git: {
      dirtyFiles: [],
      sha: CODE_SHA,
    },
    production: {
      codeSha: CODE_SHA,
      contentSha: CONTENT_SHA,
    },
    productionOverlay: {
      exists: false,
      snapshotSha: "",
    },
    staging: {
      codeSha: CODE_SHA,
      contentSha: CONTENT_SHA,
    },
    stagingDiffFromLocal: {
      files: [],
      ok: true,
    },
    stagingOverlay: {
      exists: false,
      snapshotSha: "",
    },
  });

  assert.equal(preview.staging.action, "noop");
  assert.equal(preview.production.action, "noop");
  assert.equal(preview.fileCount, 0);
});
