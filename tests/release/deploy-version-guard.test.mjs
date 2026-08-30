import assert from "node:assert/strict";
import test from "node:test";

import {
  describeVersionMismatch,
  evaluateStaleVersionGuard,
} from "../../scripts/release/deploy-cloudflare.mjs";
import { parseDeployMessage } from "../../scripts/_lib/deploy-metadata.mjs";

const CODE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CONTENT = "cccccccccccccccccccccccccccccccccccccccc";

function meta(message) {
  return parseDeployMessage(message);
}

test("version mismatch: matching code and content is clean", () => {
  const actual = meta(
    `Release upload (staging) source=${CONTENT} branch=main code=${CODE} content=${CONTENT}`,
  );
  assert.equal(
    describeVersionMismatch({ actual, expectedCodeSha: CODE, expectedContentSha: CONTENT }),
    "",
  );
});

test("version mismatch: reports stale code and stale content", () => {
  const actual = meta(`Release upload (staging) code=${CODE} content=${CONTENT}`);
  assert.match(
    describeVersionMismatch({
      actual,
      expectedCodeSha: "b".repeat(40),
      expectedContentSha: CONTENT,
    }),
    /code=/,
  );
  assert.match(
    describeVersionMismatch({
      actual,
      expectedCodeSha: CODE,
      expectedContentSha: "d".repeat(40),
    }),
    /content=/,
  );
});

test("version mismatch: no expected content SHA compares code only", () => {
  // Standalone deploy:cf:* invocations have no content snapshot to compare
  // against; the guard must judge them on the code SHA alone instead of
  // tripping on git-HEAD-vs-content-hash noise.
  const actual = meta(`Release upload (production) code=${CODE} content=${CONTENT}`);
  assert.equal(
    describeVersionMismatch({ actual, expectedCodeSha: CODE, expectedContentSha: "" }),
    "",
  );
});

test("version mismatch: missing metadata is reported, not trusted", () => {
  assert.match(
    describeVersionMismatch({
      actual: meta("Manual deploy"),
      expectedCodeSha: CODE,
      expectedContentSha: CONTENT,
    }),
    /metadata missing/,
  );
});

test("stale guard: staging mismatch blocks with a rebuild hint", () => {
  const verdict = evaluateStaleVersionGuard({
    targetEnv: "staging",
    mismatch: "code=x expected y",
  });
  assert.equal(verdict.deploy, false);
  assert.match(verdict.hint, /release:staging/);
});

test("stale guard: production mismatch now blocks too", () => {
  const verdict = evaluateStaleVersionGuard({
    targetEnv: "production",
    mismatch: "code=x expected y",
  });
  assert.equal(verdict.deploy, false);
  assert.match(verdict.hint, /ALLOW_STALE_PROD_DEPLOY=1/);
});

test("stale guard: production override deploys with a warning flag", () => {
  const verdict = evaluateStaleVersionGuard({
    targetEnv: "production",
    mismatch: "code=x expected y",
    allowStaleProdOverride: true,
  });
  assert.deepEqual(verdict, { deploy: true, warned: true });
});

test("stale guard: override never applies to staging", () => {
  const verdict = evaluateStaleVersionGuard({
    targetEnv: "staging",
    mismatch: "code=x expected y",
    allowStaleProdOverride: true,
  });
  assert.equal(verdict.deploy, false);
});

test("stale guard: clean metadata deploys on both environments", () => {
  assert.deepEqual(evaluateStaleVersionGuard({ targetEnv: "staging", mismatch: "" }), {
    deploy: true,
  });
  assert.deepEqual(evaluateStaleVersionGuard({ targetEnv: "production", mismatch: "" }), {
    deploy: true,
  });
});
