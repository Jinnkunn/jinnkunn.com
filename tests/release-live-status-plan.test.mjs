import test from "node:test";
import assert from "node:assert/strict";

import { deriveLiveReleasePlan } from "../scripts/_lib/release-live-status.mjs";

const CODE_SHA = "a".repeat(40);
const CONTENT_SHA = "b".repeat(40);
const OLD_CONTENT_SHA = "c".repeat(40);
const LOCAL_SHA = "d".repeat(40);
const STAGING_SNAPSHOT = "e".repeat(40);
const PRODUCTION_SNAPSHOT = "f".repeat(40);

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
