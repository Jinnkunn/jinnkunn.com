import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCloudflareApiDeployConfig,
  resolveCloudflareTargetEnv,
  resolveCloudflareWorkerName,
} from "../lib/server/cloudflare-deploy-env.ts";

function withEnv(t, patch) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === null || value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("cloudflare deploy env: defaults to staging when nothing set", (t) => {
  withEnv(t, {
    CLOUDFLARE_DEPLOY_ENV: null,
    DEPLOY_ENV: null,
  });
  assert.equal(resolveCloudflareTargetEnv(process.env), "staging");
});

test("cloudflare deploy env: explicit deploy env picks target", (t) => {
  withEnv(t, {
    CLOUDFLARE_DEPLOY_ENV: "staging",
  });
  assert.equal(resolveCloudflareTargetEnv(process.env), "staging");

  process.env.CLOUDFLARE_DEPLOY_ENV = "production";
  assert.equal(resolveCloudflareTargetEnv(process.env), "production");

  process.env.CLOUDFLARE_DEPLOY_ENV = "prod";
  assert.equal(resolveCloudflareTargetEnv(process.env), "production");
});

test("cloudflare deploy env: DEPLOY_ENV honored as fallback", (t) => {
  withEnv(t, {
    CLOUDFLARE_DEPLOY_ENV: null,
    DEPLOY_ENV: "staging",
  });
  assert.equal(resolveCloudflareTargetEnv(process.env), "staging");
});

test("cloudflare deploy env: worker name resolves with split env vars", (t) => {
  withEnv(t, {
    CLOUDFLARE_DEPLOY_ENV: "staging",
    CLOUDFLARE_WORKER_NAME_STAGING: "worker-staging",
    CLOUDFLARE_WORKER_NAME_PRODUCTION: "worker-production",
    CLOUDFLARE_WORKER_NAME: null,
  });
  assert.equal(resolveCloudflareWorkerName(process.env), "worker-staging");

  process.env.CLOUDFLARE_DEPLOY_ENV = "production";
  assert.equal(resolveCloudflareWorkerName(process.env), "worker-production");
});

test("cloudflare deploy env: deploy config check accepts fallback worker name", (t) => {
  withEnv(t, {
    CLOUDFLARE_DEPLOY_ENV: "staging",
    CLOUDFLARE_ACCOUNT_ID: "acc-1",
    CLOUDFLARE_API_TOKEN: "token-1",
    CLOUDFLARE_WORKER_NAME_STAGING: null,
    CLOUDFLARE_WORKER_NAME: "worker-default",
  });
  assert.equal(hasCloudflareApiDeployConfig(process.env), true);

  process.env.CLOUDFLARE_WORKER_NAME = "";
  assert.equal(hasCloudflareApiDeployConfig(process.env), false);
});
