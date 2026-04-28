import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildDeployMetadataMessage,
  describeDeployMetadataMismatch,
  parseDeployMetadataMessage,
} from "../lib/server/deploy-metadata.ts";

test("deploy metadata: parses new code/content upload messages", () => {
  const parsed = parseDeployMetadataMessage(
    "Release upload (staging) source=bbbbbbbb branch=site-admin-staging content=bbbbbbbb contentBranch=site-admin-staging code=aaaaaaaa codeBranch=main",
  );
  assert.equal(parsed.sourceSha, "bbbbbbbb");
  assert.equal(parsed.sourceBranch, "site-admin-staging");
  assert.equal(parsed.contentSha, "bbbbbbbb");
  assert.equal(parsed.contentBranch, "site-admin-staging");
  assert.equal(parsed.codeSha, "aaaaaaaa");
  assert.equal(parsed.codeBranch, "main");
});

test("deploy metadata: treats legacy source as content sha", () => {
  const parsed = parseDeployMetadataMessage(
    "Manual deploy (staging) source=cccccccc branch=site-admin-staging",
  );
  assert.equal(parsed.sourceSha, "cccccccc");
  assert.equal(parsed.contentSha, "cccccccc");
  assert.equal(parsed.contentBranch, "site-admin-staging");
  assert.equal(parsed.codeSha, null);
});

test("deploy metadata: builds compatible deploy messages", () => {
  assert.equal(
    buildDeployMetadataMessage({
      label: "Deploy from site-admin",
      codeSha: "aaaaaaaa",
      codeBranch: "main",
      contentSha: "bbbbbbbb",
      contentBranch: "site-admin-staging",
    }),
    "Deploy from site-admin source=bbbbbbbb content=bbbbbbbb branch=site-admin-staging contentBranch=site-admin-staging code=aaaaaaaa codeBranch=main",
  );
});

test("deploy metadata: reports stale deployable versions", () => {
  const mismatch = describeDeployMetadataMismatch({
    actual: parseDeployMetadataMessage(
      "Release upload (staging) source=cccccccc branch=site-admin-staging content=cccccccc contentBranch=site-admin-staging code=aaaaaaaa",
    ),
    expected: {
      codeSha: "aaaaaaaa",
      contentSha: "bbbbbbbb",
      contentBranch: "site-admin-staging",
    },
  });
  assert.match(mismatch || "", /content=cccccccc expected bbbbbbbb/);
});

test("deploy workflow: staging auto deploy uses main code plus content overlay", async () => {
  const workflow = await fs.readFile(
    path.join(process.cwd(), ".github/workflows/deploy-on-content.yml"),
    "utf8",
  );
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git fetch origin site-admin-staging:site-admin-staging/);
  assert.match(workflow, /npm run release:staging -- --skip-checks/);
  assert.doesNotMatch(workflow, /npm run release:staging -- --skip-checks --skip-build/);
  assert.doesNotMatch(workflow, /name: Build OpenNext bundle[\s\S]*npm run build:cf/);
});

test("release script refreshes staging content branch before resolving sha", async () => {
  const script = await fs.readFile(
    path.join(process.cwd(), "scripts/release-cloudflare.mjs"),
    "utf8",
  );
  assert.match(script, /refreshStagingContentBranch\(stagingContentRef\)/);
  assert.match(script, /git", \["fetch", remote, `\$\{contentRef\}:\$\{contentRef\}`\]/);
  assert.match(script, /gitValue\(\["rev-parse", stagingContentRef\]\)/);
});

test("release script refuses dirty staging releases by default", async () => {
  const script = await fs.readFile(
    path.join(process.cwd(), "scripts/release-cloudflare.mjs"),
    "utf8",
  );
  assert.match(script, /ALLOW_DIRTY_STAGING/);
  assert.match(script, /evaluateStagingDirtyGuard\(git\)/);
  assert.match(script, /content\/local\/site-config\.json/);
});

test("release script can promote staging content through the guarded production path", async () => {
  const script = await fs.readFile(
    path.join(process.cwd(), "scripts/release-cloudflare.mjs"),
    "utf8",
  );
  assert.match(script, /PROMOTE_STAGING_CONTENT/);
  assert.match(script, /args\.env === "staging" \|\| promoteStagingContent/);
  assert.match(script, /`--env=\$\{args\.env\}`/);
  assert.match(script, /DEPLOY_CONTENT_SHA: deployedContentSha/);
});

test("content overlay production uploads require explicit production confirmation", async () => {
  const script = await fs.readFile(
    path.join(process.cwd(), "scripts/build-cloudflare-content-overlay.mjs"),
    "utf8",
  );
  assert.match(script, /CONFIRM_PRODUCTION_DEPLOY=1 is required/);
  assert.match(script, /CONFIRM_PRODUCTION_SHA=\$\{codeSha\} is required/);
  assert.match(script, /CONFIRM_PRODUCTION_SHA does not match code ref/);
});
