import assert from "node:assert/strict";
import test from "node:test";

import { triggerDeployHook } from "../lib/server/deploy-hook-core.ts";

const DEPLOY_ENV_KEYS = [
  "DEPLOY_PROVIDER",
  "DEPLOY_HOOK_URL",
  "DEPLOY_ENV",
  "CLOUDFLARE_DEPLOY_ENV",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CF_API_TOKEN",
  "CLOUDFLARE_WORKER_NAME",
  "CLOUDFLARE_WORKER_NAME_STAGING",
  "CLOUDFLARE_WORKER_NAME_PRODUCTION",
  "SITE_ADMIN_REPO_BRANCH",
  "SITE_ADMIN_REPO_BRANCH_STAGING",
  "SITE_ADMIN_REPO_BRANCH_PRODUCTION",
];

function withMockFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
  });
}

function withCleanDeployEnv(t, patch = {}) {
  const previous = {};
  const keys = new Set([...DEPLOY_ENV_KEYS, ...Object.keys(patch)]);
  for (const key of keys) {
    const value = Object.hasOwn(patch, key) ? patch[key] : null;
    previous[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("deploy-hook cloudflare: promotes latest worker version via API", async (t) => {
  withCleanDeployEnv(t, {
    DEPLOY_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "acc-1",
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_WORKER_NAME: "site-worker",
  });

  const calls = [];
  withMockFetch(t, async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/workers/scripts/site-worker/versions")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            items: [{ id: "11111111-1111-1111-1111-111111111111", number: 8 }],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (String(url).includes("/workers/scripts/site-worker/deployments")) {
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(body.strategy, "percentage");
      assert.equal(body.versions[0].version_id, "11111111-1111-1111-1111-111111111111");
      assert.equal(body.versions[0].percentage, 100);
      assert.equal(body.annotations["workers/message"], "Deploy from site-admin");
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            id: "22222222-2222-2222-2222-222222222222",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  });

  const out = await triggerDeployHook();
  assert.equal(out.ok, true);
  assert.equal(out.provider, "cloudflare");
  assert.equal(out.deploymentId, "22222222-2222-2222-2222-222222222222");
  assert.equal(out.attempts, 1);
  assert.equal(calls.length, 2);
});

test("deploy-hook cloudflare: allows custom deployment message", async (t) => {
  withCleanDeployEnv(t, {
    DEPLOY_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "acc-1",
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_WORKER_NAME: "site-worker",
  });

  withMockFetch(t, async (url, init = {}) => {
    if (String(url).includes("/workers/scripts/site-worker/versions")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: { items: [{ id: "11111111-1111-1111-1111-111111111111" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (String(url).includes("/workers/scripts/site-worker/deployments")) {
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(
        body.annotations["workers/message"],
        "Deploy from site-admin source=abc1234",
      );
      return new Response(
        JSON.stringify({
          success: true,
          result: { id: "33333333-3333-3333-3333-333333333333" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  });

  const out = await triggerDeployHook(undefined, {
    message: "Deploy from site-admin source=abc1234",
  });
  assert.equal(out.ok, true);
  assert.equal(out.deploymentId, "33333333-3333-3333-3333-333333333333");
});

test("deploy-hook cloudflare: refuses stale latest worker version metadata", async (t) => {
  withCleanDeployEnv(t, {
    DEPLOY_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "acc-1",
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_WORKER_NAME: "site-worker",
  });

  let deploymentCalls = 0;
  withMockFetch(t, async (url) => {
    if (String(url).includes("/workers/scripts/site-worker/versions")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            items: [
              {
                id: "11111111-1111-1111-1111-111111111111",
                annotations: {
                  "workers/message":
                    "Release upload (staging) source=cccccccc content=cccccccc branch=site-admin-staging contentBranch=site-admin-staging code=aaaaaaaa",
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (String(url).includes("/workers/scripts/site-worker/deployments")) {
      deploymentCalls += 1;
    }
    return new Response("Not Found", { status: 404 });
  });

  const out = await triggerDeployHook(undefined, {
    expectedCloudflareVersion: {
      codeSha: "aaaaaaaa",
      contentSha: "bbbbbbbb",
      contentBranch: "site-admin-staging",
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
  assert.match(out.text, /DEPLOY_VERSION_STALE/);
  assert.equal(deploymentCalls, 0);
});

test("deploy-hook cloudflare: prefers staging worker name when CLOUDFLARE_DEPLOY_ENV=staging", async (t) => {
  withCleanDeployEnv(t, {
    DEPLOY_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "acc-1",
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_DEPLOY_ENV: "staging",
    CLOUDFLARE_WORKER_NAME_STAGING: "site-worker-staging",
    CLOUDFLARE_WORKER_NAME_PRODUCTION: "site-worker-production",
    CLOUDFLARE_WORKER_NAME: null,
  });

  const urls = [];
  withMockFetch(t, async (url, init = {}) => {
    const target = String(url);
    urls.push(target);
    if (target.includes("/workers/scripts/site-worker-staging/versions")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: { items: [{ id: "11111111-1111-1111-1111-111111111111" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (target.includes("/workers/scripts/site-worker-staging/deployments")) {
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(body.versions[0].version_id, "11111111-1111-1111-1111-111111111111");
      return new Response(
        JSON.stringify({
          success: true,
          result: { id: "44444444-4444-4444-4444-444444444444" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  });

  const out = await triggerDeployHook();
  assert.equal(out.ok, true);
  assert.equal(out.provider, "cloudflare");
  assert.equal(out.deploymentId, "44444444-4444-4444-4444-444444444444");
  assert.equal(urls.every((url) => !url.includes("site-worker-production")), true);
});

test("deploy-hook cloudflare: falls back to DEPLOY_HOOK_URL when cloudflare env is incomplete", async (t) => {
  withCleanDeployEnv(t, {
    DEPLOY_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "acc-1",
    CLOUDFLARE_API_TOKEN: null,
    CLOUDFLARE_WORKER_NAME: null,
    DEPLOY_HOOK_URL: "https://example.com/deploy",
  });

  let calls = 0;
  withMockFetch(t, async (url) => {
    calls += 1;
    assert.equal(String(url), "https://example.com/deploy");
    return new Response("ok", { status: 200 });
  });

  const out = await triggerDeployHook(undefined, {
    timeoutMs: 1_000,
    maxAttempts: 1,
    retryBaseDelayMs: 1,
  });
  assert.equal(out.ok, true);
  assert.equal(out.provider, "cloudflare");
  assert.equal(out.status, 200);
  assert.equal(out.attempts, 1);
  assert.equal(calls, 1);
});
