import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildDeployMetadataMessage,
  describeDeployMetadataMismatch,
  parseDeployMetadataMessage,
} from "../../lib/server/deploy-metadata.ts";

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

test("release script uses a clean snapshot for dirty staging releases", async () => {
  const script = await fs.readFile(
    path.join(process.cwd(), "scripts/release/release-cloudflare.mjs"),
    "utf8",
  );
  assert.match(script, /prepareCleanReleaseSnapshot/);
  assert.match(script, /evaluateStagingDirtyGuard\(git\)/);
  assert.match(script, /ALLOW_D1_BUILD_CACHE/);
  assert.match(script, /RELEASE_REUSE_STAGING_BUILD/);
  assert.match(script, /RELEASE_EXPECT_CONTENT_SHA/);
  assert.match(script, /buildCacheContentMatches/);
  assert.match(script, /contentSnapshotSha/);
  assert.match(script, /hashReleaseContent/);
  assert.match(script, /content\/local\/site-config\.json/);
});

test("content publish path uses D1 static-shell overlays with asset guards", async () => {
  const [script, worker, wrangler] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "scripts/content/publish-content.mjs"), "utf8"),
    fs.readFile(path.join(process.cwd(), "cloudflare/worker-entry.mjs"), "utf8"),
    fs.readFile(path.join(process.cwd(), "wrangler.toml"), "utf8"),
  ]);
  assert.match(script, /fetchLiveBuildId/);
  assert.match(script, /hashContentInput/);
  assert.match(script, /contentInputSha/);
  assert.match(script, /RUNTIME_CONTENT_INPUT_REL_PATHS/);
  assert.match(script, /content\/now\.json/);
  assert.match(script, /workerCodeSha/);
  assert.match(script, /skipping build and upload/);
  assert.match(script, /copyStagingOverlayToProduction/);
  assert.match(script, /NEXT_BUILD_ID/);
  assert.match(script, /assertReferencedAssetsExist/);
  assert.match(script, /static_shell_overlays/);
  assert.match(script, /static_shell_overlay_snapshots/);
  assert.match(script, /prepareOverlayDiff/);
  assert.match(script, /restoreOverlaySnapshot/);
  assert.match(script, /verifyOverlayServing/);
  assert.match(script, /--from-staging/);
  assert.match(worker, /x-static-overlay/);
  assert.match(worker, /fetchStaticOverlay/);
  assert.match(worker, /STATIC_SHELL_OVERLAY/);
  assert.match(worker, /cloneStaticRequest\(request, currentUrl, "GET"\)/);
  assert.match(worker, /request\.method === "HEAD" \? null : res\.body/);
  assert.match(wrangler, /STATIC_SHELL_OVERLAY = "1"/);
});

test("smart release CLI and package scripts expose content production copy", async () => {
  const [releaseSite, releaseStatus, liveStatus, packageJson] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "scripts/release/release-site.mjs"), "utf8"),
    fs.readFile(path.join(process.cwd(), "scripts/release/release-status.mjs"), "utf8"),
    fs.readFile(path.join(process.cwd(), "scripts/_lib/release-live-status.mjs"), "utf8"),
    fs.readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ]);
  assert.match(releaseSite, /buildLiveReleaseStatus/);
  assert.match(releaseStatus, /Route Parity|routeParity|DEFAULT_RELEASE_ROUTES/);
  assert.match(liveStatus, /deriveLiveReleasePlan/);
  assert.match(liveStatus, /RUNTIME_CONTENT_INPUT_REL_PATHS/);
  assert.match(liveStatus, /publish-content-production-from-staging/);
  assert.match(liveStatus, /publish:content:prod:from-staging/);
  assert.match(liveStatus, /publish-now-production-from-staging/);
  assert.match(packageJson, /"publish:now:prod:from-staging"/);
  assert.match(packageJson, /"release:site"/);
  assert.match(packageJson, /"release:status"/);
  assert.match(packageJson, /"publish:content:prod:from-staging"/);
});

test("full Cloudflare release clears stale content overlays after code deploy", async () => {
  const script = await fs.readFile(
    path.join(process.cwd(), "scripts/release/release-cloudflare.mjs"),
    "utf8",
  );
  assert.match(script, /clearContentOverlayAfterCodeDeploy/);
  assert.match(script, /--clear/);
  assert.match(script, /overlayClear/);
});
