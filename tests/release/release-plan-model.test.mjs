import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("release plan model: exposes smart release action kinds and scripts", async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), "apps/workspace/src/surfaces/site-admin/release-flow-model.ts"),
    "utf8",
  );
  assert.match(source, /export type ReleaseActionKind/);
  assert.match(source, /"publish-content-staging"/);
  assert.match(source, /"deploy-staging-code"/);
  assert.match(source, /"promote-production-code"/);
  assert.match(source, /"publish-content-production-from-staging"/);
  assert.match(source, /"noop"/);
  assert.match(source, /"blocked"/);
  assert.match(source, /export type ReleaseTarget = "staging" \| "production"/);
  assert.match(source, /PUBLISH_CONTENT_STAGING_SCRIPT/);
  assert.match(source, /PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT/);
  assert.match(source, /RELEASE_STAGING_SCRIPT/);
  assert.match(source, /RELEASE_PROD_FROM_STAGING_SCRIPT/);
});

test("release plan model: prioritizes blockers, staging code, content, production, and no-op", async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), "apps/workspace/src/surfaces/site-admin/release-flow-model.ts"),
    "utf8",
  );
  assert.match(source, /if \(!input\.isStaging\)/);
  assert.match(source, /if \(input\.jobRunning\)/);
  assert.match(source, /if \(input\.localDirty\)/);
  assert.match(source, /const stagingBehind =/);
  assert.match(source, /if \(stagingBehind\)/);
  assert.match(source, /if \(input\.contentChanged\)/);
  assert.match(source, /if \(input\.target === "staging"\)/);
  assert.match(source, /if \(input\.readyToPromote\)/);
  assert.match(source, /const stagingOverlayDiffers =/);
  assert.match(source, /if \(input\.productionAlreadyCurrent\)/);
});
