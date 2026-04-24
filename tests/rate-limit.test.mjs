import assert from "node:assert/strict";
import test from "node:test";

import {
  checkRateLimit,
  requestIpFromHeaders,
  resetRateLimitForTests,
} from "../lib/server/rate-limit.ts";

test("rate-limit: first call for an IP is always allowed", () => {
  resetRateLimitForTests();
  const result = checkRateLimit({
    namespace: "test-first",
    ip: "10.0.0.1",
    maxRequests: 3,
    windowMs: 60_000,
    nowMs: 1_700_000_000_000,
  });
  assert.equal(result.ok, true);
});

test("rate-limit: allows up to maxRequests within window, then blocks", () => {
  resetRateLimitForTests();
  const base = 1_700_000_000_000;
  for (let i = 0; i < 3; i++) {
    const out = checkRateLimit({
      namespace: "test-block",
      ip: "10.0.0.2",
      maxRequests: 3,
      windowMs: 60_000,
      nowMs: base + i * 100,
    });
    assert.equal(out.ok, true, `request ${i} should pass`);
  }

  const blocked = checkRateLimit({
    namespace: "test-block",
    ip: "10.0.0.2",
    maxRequests: 3,
    windowMs: 60_000,
    nowMs: base + 400,
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(typeof blocked.retryAfterSec, "number");
  assert.ok(blocked.retryAfterSec > 0);
});

test("rate-limit: window reset frees the IP after windowMs", () => {
  resetRateLimitForTests();
  const base = 1_700_000_000_000;
  for (let i = 0; i < 2; i++) {
    const out = checkRateLimit({
      namespace: "test-reset",
      ip: "10.0.0.3",
      maxRequests: 2,
      windowMs: 60_000,
      nowMs: base + i,
    });
    assert.equal(out.ok, true);
  }
  // Still inside the window.
  const blocked = checkRateLimit({
    namespace: "test-reset",
    ip: "10.0.0.3",
    maxRequests: 2,
    windowMs: 60_000,
    nowMs: base + 30_000,
  });
  assert.equal(blocked.ok, false);

  // Past the window.
  const recovered = checkRateLimit({
    namespace: "test-reset",
    ip: "10.0.0.3",
    maxRequests: 2,
    windowMs: 60_000,
    nowMs: base + 60_001,
  });
  assert.equal(recovered.ok, true);
});

test("rate-limit: namespaces are isolated buckets", () => {
  resetRateLimitForTests();
  const base = 1_700_000_000_000;
  for (let i = 0; i < 2; i++) {
    checkRateLimit({
      namespace: "ns-a",
      ip: "10.0.0.4",
      maxRequests: 2,
      windowMs: 60_000,
      nowMs: base + i,
    });
  }
  // A-bucket is full, but B-bucket is empty.
  const aBlocked = checkRateLimit({
    namespace: "ns-a",
    ip: "10.0.0.4",
    maxRequests: 2,
    windowMs: 60_000,
    nowMs: base + 10,
  });
  assert.equal(aBlocked.ok, false);

  const bPasses = checkRateLimit({
    namespace: "ns-b",
    ip: "10.0.0.4",
    maxRequests: 2,
    windowMs: 60_000,
    nowMs: base + 10,
  });
  assert.equal(bPasses.ok, true);
});

test("rate-limit: separate IPs do not share a bucket", () => {
  resetRateLimitForTests();
  const base = 1_700_000_000_000;
  for (let i = 0; i < 2; i++) {
    checkRateLimit({
      namespace: "test-ips",
      ip: "10.0.0.5",
      maxRequests: 2,
      windowMs: 60_000,
      nowMs: base + i,
    });
  }
  const firstIpBlocked = checkRateLimit({
    namespace: "test-ips",
    ip: "10.0.0.5",
    maxRequests: 2,
    windowMs: 60_000,
    nowMs: base + 10,
  });
  assert.equal(firstIpBlocked.ok, false);

  const secondIp = checkRateLimit({
    namespace: "test-ips",
    ip: "10.0.0.6",
    maxRequests: 2,
    windowMs: 60_000,
    nowMs: base + 10,
  });
  assert.equal(secondIp.ok, true);
});

test("rate-limit: missing IP falls back to a shared 'unknown' bucket", () => {
  resetRateLimitForTests();
  const base = 1_700_000_000_000;
  for (let i = 0; i < 2; i++) {
    checkRateLimit({
      namespace: "test-unknown",
      ip: "",
      maxRequests: 2,
      windowMs: 60_000,
      nowMs: base + i,
    });
  }
  const blocked = checkRateLimit({
    namespace: "test-unknown",
    ip: "",
    maxRequests: 2,
    windowMs: 60_000,
    nowMs: base + 10,
  });
  assert.equal(blocked.ok, false);
});

test("requestIpFromHeaders: prefers first entry from x-forwarded-for", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" });
  assert.equal(requestIpFromHeaders(headers), "203.0.113.1");
});

test("requestIpFromHeaders: falls back to x-real-ip then 'unknown'", () => {
  const h1 = new Headers({ "x-real-ip": "198.51.100.42" });
  assert.equal(requestIpFromHeaders(h1), "198.51.100.42");

  const h2 = new Headers();
  assert.equal(requestIpFromHeaders(h2), "unknown");
});
