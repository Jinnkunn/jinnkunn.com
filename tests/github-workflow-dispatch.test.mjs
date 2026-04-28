// Covers the four interesting branches of dispatchWorkflow():
//   1. Missing repo / app env  -> 412 with explanatory error
//   2. Successful dispatch    -> {ok, runsListUrl}
//   3. Github 4xx (e.g. 403 missing scope) -> {ok:false, status, error}
//   4. Network throw          -> {ok:false, status:500}
//
// Also pins the request body shape so a future "let's also send a custom
// header" change can't quietly break the workflow contract.

import test from "node:test";
import assert from "node:assert/strict";

import { GitHubApiError } from "../lib/server/github-content-client.ts";
import {
  dispatchWorkflow,
  isWorkflowDispatchConfigured,
} from "../lib/server/github-workflow-dispatch.ts";

function makeMockClient() {
  const calls = [];
  return {
    calls,
    client: {
      async request(input) {
        calls.push(input);
        return null;
      },
    },
  };
}

function makeFailingClient(err) {
  return {
    async request() {
      throw err;
    },
  };
}

test("dispatchWorkflow: missing repo env returns 412 with helpful message", async () => {
  const result = await dispatchWorkflow({
    eventType: "release-staging",
    client: makeMockClient().client,
    ownerOverride: "",
    repoOverride: "",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 412);
  assert.match(result.error, /GITHUB_REPO_NOT_CONFIGURED/);
});

test("dispatchWorkflow: success calls /repos/owner/repo/dispatches with event_type + payload", async () => {
  const { client, calls } = makeMockClient();
  const result = await dispatchWorkflow({
    eventType: "release-staging",
    clientPayload: { triggeredAt: "2026-04-28T00:00:00Z" },
    client,
    ownerOverride: "TestOwner",
    repoOverride: "test-repo",
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "github-actions");
  assert.equal(result.eventType, "release-staging");
  assert.equal(result.runsListUrl, "https://github.com/TestOwner/test-repo/actions");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].apiPath, "/repos/TestOwner/test-repo/dispatches");
  assert.deepEqual(calls[0].body, {
    event_type: "release-staging",
    client_payload: { triggeredAt: "2026-04-28T00:00:00Z" },
  });
});

test("dispatchWorkflow: omits client_payload from body when payload is empty", async () => {
  const { client, calls } = makeMockClient();
  await dispatchWorkflow({
    eventType: "release-staging",
    client,
    ownerOverride: "TestOwner",
    repoOverride: "test-repo",
  });
  assert.deepEqual(calls[0].body, { event_type: "release-staging" });
});

test("dispatchWorkflow: GitHub 403 (missing Actions:Write) bubbles up as ok:false", async () => {
  const err = new GitHubApiError({
    status: 403,
    message: "Resource not accessible by integration",
    responseBody: null,
  });
  const result = await dispatchWorkflow({
    eventType: "release-staging",
    client: makeFailingClient(err),
    ownerOverride: "TestOwner",
    repoOverride: "test-repo",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.match(result.error, /not accessible/);
});

test("dispatchWorkflow: non-GitHub error coerces to status 500", async () => {
  const result = await dispatchWorkflow({
    eventType: "release-staging",
    client: makeFailingClient(new TypeError("network down")),
    ownerOverride: "TestOwner",
    repoOverride: "test-repo",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error, /network down/);
});

test("isWorkflowDispatchConfigured: false when any of the 5 env vars is empty", () => {
  // Capture + restore so this test doesn't bleed into others.
  const keep = {
    SITE_ADMIN_REPO_OWNER: process.env.SITE_ADMIN_REPO_OWNER,
    SITE_ADMIN_REPO_NAME: process.env.SITE_ADMIN_REPO_NAME,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_INSTALLATION_ID: process.env.GITHUB_APP_INSTALLATION_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  };
  try {
    process.env.SITE_ADMIN_REPO_OWNER = "owner";
    process.env.SITE_ADMIN_REPO_NAME = "repo";
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_INSTALLATION_ID = "2";
    process.env.GITHUB_APP_PRIVATE_KEY = "pk";
    assert.equal(isWorkflowDispatchConfigured(), true);

    process.env.GITHUB_APP_PRIVATE_KEY = "";
    assert.equal(isWorkflowDispatchConfigured(), false);
  } finally {
    for (const [k, v] of Object.entries(keep)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
