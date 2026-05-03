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

test("release script uses a clean snapshot for dirty staging releases", async () => {
  const script = await fs.readFile(
    path.join(process.cwd(), "scripts/release-cloudflare.mjs"),
    "utf8",
  );
  assert.match(script, /prepareCleanReleaseSnapshot/);
  assert.match(script, /evaluateStagingDirtyGuard\(git\)/);
  assert.match(script, /ALLOW_D1_BUILD_CACHE/);
  assert.match(script, /hashReleaseContent/);
  assert.match(script, /content\/local\/site-config\.json/);
});
