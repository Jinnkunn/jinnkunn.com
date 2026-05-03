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
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWorkflow() {
  return readFileSync(
    path.join(ROOT, ".github/workflows/release-from-dispatch.yml"),
    "utf8",
  );
}

test("release-from-dispatch: SITE_ADMIN_DB_ENV is pinned to staging for both targets", () => {
  // Incident (2026-04-29): SITE_ADMIN_DB_ENV used to track TARGET_ENV, so
  // production builds dumped from production D1 — which the operator never
  // writes to. A workspace nav addition lived in staging D1 only; the
  // production deploy dumped a stale 1.3 KB site-config from production D1
  // and shipped a worker with no Calendar nav even though the code SHA was
  // correct. Always dumping staging D1 makes "Promote to Production" ship
  // exactly what the operator just looked at on staging.
  const yaml = readWorkflow();
  assert.match(
    yaml,
    /SITE_ADMIN_DB_ENV:\s*staging\b/,
    "SITE_ADMIN_DB_ENV must be pinned to literal `staging`, not bound to TARGET_ENV",
  );
  assert.doesNotMatch(
    yaml,
    /SITE_ADMIN_DB_ENV:\s*\$\{\{\s*env\.TARGET_ENV\s*\}\}/,
    "SITE_ADMIN_DB_ENV must NOT track TARGET_ENV — production has no operator path that writes to its D1",
  );
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

test("release-from-dispatch: staging≡release-source SHA guard fires on production releases", () => {
  // Defense-in-depth for the manual GitHub Actions fallback. The normal
  // workspace path runs local Cloudflare release commands; this workflow
  // re-checks because `gh workflow run … -f env=production` bypasses the
  // local preflight entirely. Comparing CF API + GITHUB_SHA in the runner
  // means an out-of-band trigger can't ship code staging hasn't validated.
  const yaml = readWorkflow();
  assert.match(
    yaml,
    /Guard\s*—\s*staging matches release source before production releases/,
    "staging≡release-source guard step is missing or renamed",
  );
  assert.match(
    yaml,
    /if:\s*env\.TARGET_ENV\s*==\s*'production'/,
    "guard must only fire when TARGET_ENV=production",
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
    /node scripts\/smoke-deployed\.mjs --env=\$TARGET_ENV/,
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
