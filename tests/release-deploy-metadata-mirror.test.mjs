import test from "node:test";
import assert from "node:assert/strict";

import {
  compareDeploymentToReleaseSource,
  effectiveCodeSha,
  parseDeployMessage,
} from "../scripts/_lib/deploy-metadata.mjs";
import { parseDeployMetadataMessage } from "../lib/server/deploy-metadata.ts";

// Pin both impls of the deploy-metadata parser to the same fixtures.
// The script-side mirror returns "" for missing tokens; the canonical
// TS version returns null. Normalize for comparison so a future divergence
// (someone adding a field to one but not the other, changing the regex,
// etc.) fails this test instead of silently desyncing the
// release-cloudflare upload metadata from the promote/dispatch reads.

const FIXTURES = [
  {
    name: "release-cloudflare staging upload (full set)",
    message:
      "Release upload (staging) source=abc1234 branch=main code=abc1234 codeBranch=main content=abc1234 contentBranch=main",
  },
  {
    name: "release-cloudflare production upload with dirty",
    message:
      "Release upload (production) source=ffeeddc branch=main code=ffeeddc codeBranch=main content=ffeeddc contentBranch=main dirty=1",
  },
  {
    name: "legacy single-source manual deploy",
    message: "Manual deploy (staging) source=cccccccc branch=site-admin-staging",
  },
  {
    name: "overlay release with separate code + content",
    message:
      "Release upload (staging) source=bbbbbbbb branch=site-admin-staging content=bbbbbbbb contentBranch=site-admin-staging code=aaaaaaaa codeBranch=main",
  },
  {
    name: "empty annotation",
    message: "",
  },
];

function normalize(meta) {
  return {
    sourceSha: meta.sourceSha || "",
    sourceBranch: meta.sourceBranch || "",
    codeSha: meta.codeSha || "",
    codeBranch: meta.codeBranch || "",
    contentSha: meta.contentSha || "",
    contentBranch: meta.contentBranch || "",
  };
}

for (const fixture of FIXTURES) {
  test(`deploy-metadata mirror parses identically: ${fixture.name}`, () => {
    const fromMjs = normalize(parseDeployMessage(fixture.message));
    const fromTs = normalize(parseDeployMetadataMessage(fixture.message));
    assert.deepEqual(fromMjs, fromTs);
  });
}

test("effectiveCodeSha falls back to sourceSha when codeSha missing", () => {
  const meta = parseDeployMessage("Manual deploy source=deadbeef branch=main");
  assert.equal(effectiveCodeSha(meta), "deadbeef");
});

test("compareDeploymentToReleaseSource reports STAGING_SOURCE_MISMATCH with both SHAs", () => {
  const meta = parseDeployMessage(
    "Release upload (staging) source=aaaaaaa branch=main code=aaaaaaa contentBranch=main",
  );
  const verdict = compareDeploymentToReleaseSource({ meta, sourceSha: "bbbbbbb" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "STAGING_SOURCE_MISMATCH");
  assert.match(verdict.detail, /staging: aaaaaaa/);
  assert.match(verdict.detail, /source:  bbbbbbb/);
});

test("compareDeploymentToReleaseSource returns ok when SHAs match (case-insensitive)", () => {
  const meta = parseDeployMessage(
    "Release upload (staging) source=ABC1234 branch=main code=abc1234",
  );
  const verdict = compareDeploymentToReleaseSource({ meta, sourceSha: "ABC1234" });
  assert.equal(verdict.ok, true);
});

test("compareDeploymentToReleaseSource flags STAGING_METADATA_UNREADABLE on empty meta", () => {
  const meta = parseDeployMessage("");
  const verdict = compareDeploymentToReleaseSource({ meta, sourceSha: "abc1234" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "STAGING_METADATA_UNREADABLE");
});
