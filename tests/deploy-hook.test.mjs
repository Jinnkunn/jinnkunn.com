import assert from "node:assert/strict";
import test from "node:test";

import { triggerDeployHook } from "../lib/server/deploy-hook-core.ts";

function withMockFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
  });
}

test("deploy-hook: missing hook url fails fast", async () => {
  const out = await triggerDeployHook("");
  assert.equal(out.ok, false);
  assert.equal(out.status, 500);
  assert.equal(out.attempts, 0);
});

test("deploy-hook: succeeds on first attempt", async (t) => {
  let calls = 0;
  withMockFetch(t, async () => {
    calls += 1;
    return new Response("ok", { status: 200 });
  });

  const out = await triggerDeployHook("https://example.com/hook", {
    timeoutMs: 1000,
    maxAttempts: 3,
    retryBaseDelayMs: 1,
  });

  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.equal(out.text, "ok");
  assert.equal(out.attempts, 1);
  assert.equal(calls, 1);
});

test("deploy-hook: retries retryable status and then succeeds", async (t) => {
  let calls = 0;
  withMockFetch(t, async () => {
    calls += 1;
    if (calls === 1) return new Response("upstream error", { status: 500 });
    return new Response("accepted", { status: 202 });
  });

  const out = await triggerDeployHook("https://example.com/hook", {
    timeoutMs: 1000,
    maxAttempts: 3,
    retryBaseDelayMs: 1,
  });

  assert.equal(out.ok, true);
  assert.equal(out.status, 202);
  assert.equal(out.text, "accepted");
  assert.equal(out.attempts, 2);
  assert.equal(calls, 2);
});

test("deploy-hook: does not retry non-retryable status", async (t) => {
  let calls = 0;
  withMockFetch(t, async () => {
    calls += 1;
    return new Response("bad request", { status: 400 });
  });

  const out = await triggerDeployHook("https://example.com/hook", {
    timeoutMs: 1000,
    maxAttempts: 3,
    retryBaseDelayMs: 1,
  });

  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(out.attempts, 1);
  assert.equal(calls, 1);
});

test("deploy-hook: timeout returns 504", async (t) => {
  let calls = 0;
  withMockFetch(t, async (_url, init = {}) => {
    calls += 1;
    const signal = init.signal;
    return await new Promise((_resolve, reject) => {
      if (!signal || typeof signal.addEventListener !== "function") {
        reject(new Error("missing abort signal"));
        return;
      }
      signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  });

  const out = await triggerDeployHook("https://example.com/hook", {
    timeoutMs: 5,
    maxAttempts: 1,
    retryBaseDelayMs: 1,
  });

  assert.equal(out.ok, false);
  assert.equal(out.status, 504);
  assert.equal(out.attempts, 1);
  assert.equal(calls, 1);
});
