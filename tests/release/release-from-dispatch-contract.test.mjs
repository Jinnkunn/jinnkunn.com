// Pins behavior of `.github/workflows/release-from-dispatch.yml` that has
// historically broken silently — once the workflow YAML reaches GitHub, a
// subtle change can land production with stale content (or worse, lock the
// workflow_dispatch trigger out and leave the operator unable to ship).
//
// Each assertion here corresponds to a real incident the workflow recovered
// from. Don't relax these without writing the next incident's postmortem
// first.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();

function readWorkflow() {
  return readFileSync(
    path.join(ROOT, ".github/workflows/release-from-dispatch.yml"),
    "utf8",
  );
}

test("release-from-dispatch: guarded CLI owns both staging and production", () => {
  const yaml = readWorkflow();
  assert.match(yaml, /npm run release:staging -- --skip-checks/);
  assert.match(yaml, /npm run release:prod:from-staging\b/);
  assert.doesNotMatch(yaml, /npm run release:prod --/);
  assert.match(yaml, /playwright-core install --with-deps chromium/);
});

test("release-from-dispatch: workflow_dispatch + repository_dispatch triggers are present", () => {
  // Incident (same day): a multiline Python heredoc inside `run: |` had a
  // column-0 line, which YAML treats as the end of the literal block scalar.
  // The whole `on:` block silently parsed as out-of-block content; GitHub
  // dropped both triggers and `gh workflow run release-from-dispatch.yml`
  // started returning HTTP 422 "Workflow does not have 'workflow_dispatch'
  // trigger" — i.e. the operator could not ship at all. Re-asserting both
  // triggers catches a regression at test time, before push.
  const yaml = readWorkflow();
  assert.match(yaml, /^\s*workflow_dispatch:/m, "workflow_dispatch trigger missing");
  assert.match(yaml, /^\s*repository_dispatch:/m, "repository_dispatch trigger missing");
  assert.match(
    yaml,
    /types:\s*\n\s*-\s*release-staging\s*\n\s*-\s*release-production/,
    "repository_dispatch must keep release-staging + release-production action types",
  );
});

test("release-from-dispatch: post-deploy smoke walks real routes, not just /robots.txt", () => {
  // Old incarnation only curl'd /robots.txt — happily reported "OK" while
  // every actual page 5xx'd. smoke-deployed.mjs now asserts a content marker
  // on /, /blog, /publications, /calendar etc., so a worker that boots but
  // routes wrong fails CI.
  const yaml = readWorkflow();
  assert.match(
    yaml,
    /node scripts\/qa\/smoke-deployed\.mjs --env=\$TARGET_ENV/,
    "smoke step must call smoke-deployed.mjs (not the old robots.txt curl)",
  );
});

test("release-from-dispatch: GitHub Deployment record is opened then resolved", () => {
  // The Deployment record is the only audit trail of "did the last deploy
  // succeed" that survives outside the GitHub Actions tab. Both halves
  // matter: opening with state=in_progress, then flipping to success/failure
  // via an `if: always()` step so a cancelled run doesn't leave a phantom
  // in_progress entry.
  const yaml = readWorkflow();
  assert.match(yaml, /createDeployment/, "Deployment record open step must call createDeployment");
  assert.match(
    yaml,
    /createDeploymentStatus[\s\S]*if:\s*always\(\)\s*&&\s*steps\.gh_deployment\.outputs\.id/,
    "Mark-status step must run `if: always()` so failures flip the record",
  );
  assert.match(
    yaml,
    /deployments:\s*write/,
    "permissions block must grant `deployments: write` for the Deployment API",
  );
});
