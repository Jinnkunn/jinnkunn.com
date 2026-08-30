import assert from "node:assert/strict";
import test from "node:test";

import { collectRedactionValues } from "../../scripts/release/release-agent.mjs";

test("redaction: collects every credential-named env value, not a fixed list", () => {
  const env = {
    SITE_ADMIN_RELEASE_AGENT_TOKEN: "agent-token-value-1234",
    CLOUDFLARE_API_TOKEN: "cf-api-token-value",
    // The two that the old 7-name allowlist missed:
    RELEASE_AGENT_WAKE_TOKEN: "wake-token-value-5678",
    RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET: "cf-access-client-secret-value",
    CLOUDFLARE_ACCOUNT_ID: "abcdef1234567890",
    SOME_FUTURE_SIGNING_KEY: "future-signing-key-value",
    DB_PASSWORD: "database-password",
  };
  const values = collectRedactionValues(env);
  for (const expected of Object.values(env)) {
    assert.ok(values.includes(expected), `expected ${expected} to be redacted`);
  }
});

test("redaction: public and non-credential values stay readable", () => {
  const env = {
    // Matches AUTH but is public by construction (an https URL).
    NEXTAUTH_URL: "https://staging.jinkunchen.com",
    // Too short to be a credential worth scrubbing from every log line.
    SHORT_TOKEN: "tiny",
    // Name carries no credential word at all.
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    RELEASE_AGENT_REPO: "/Users/jinnkunn/Services/jinnkunn-release-runner/repo",
  };
  assert.deepEqual(collectRedactionValues(env), []);
});

test("redaction: longest value first so overlapping secrets leave no residue", () => {
  const env = {
    DEPLOY_TOKEN: "secret",
    SITE_ADMIN_APP_TOKEN_SECRET: "secret-with-a-longer-suffix",
  };
  const values = collectRedactionValues({
    ...env,
    DEPLOY_TOKEN: "secretpad", // >= 8 chars
  });
  assert.equal(values[0], "secret-with-a-longer-suffix");
});

test("redaction: duplicate values collapse to one replacement", () => {
  const values = collectRedactionValues({
    CLOUDFLARE_API_TOKEN: "shared-token-value",
    CF_API_TOKEN: "shared-token-value",
  });
  assert.deepEqual(values, ["shared-token-value"]);
});
