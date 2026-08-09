import assert from "node:assert/strict";
import test from "node:test";

import {
  checkRateLimit,
  requestIpFromHeaders,
  resetRateLimitForTests,
} from "../../lib/server/rate-limit.ts";

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

test("requestIpFromHeaders: prefers cf-connecting-ip over a forged x-forwarded-for", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.7",
    "x-forwarded-for": "1.2.3.4, 203.0.113.7",
    "true-client-ip": "9.9.9.9",
  });
  assert.equal(requestIpFromHeaders(headers), "203.0.113.7");
});

test("requestIpFromHeaders: falls back to true-client-ip before x-forwarded-for", () => {
  const headers = new Headers({
    "true-client-ip": "203.0.113.8",
    "x-forwarded-for": "1.2.3.4",
  });
  assert.equal(requestIpFromHeaders(headers), "203.0.113.8");
});

test("requestIpFromHeaders: takes the LAST x-forwarded-for segment", () => {
  // Cloudflare appends the real peer, so only the tail is trustworthy.
  const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.1" });
  assert.equal(requestIpFromHeaders(headers), "203.0.113.1");
});

test("requestIpFromHeaders: falls back to x-real-ip then 'unknown'", () => {
  const h1 = new Headers({ "x-real-ip": "198.51.100.42" });
  assert.equal(requestIpFromHeaders(h1), "198.51.100.42");

  const h2 = new Headers();
  assert.equal(requestIpFromHeaders(h2), "unknown");
});

test("rate-limit: a forged x-forwarded-for cannot move the bucket when cf-connecting-ip is set", () => {
  resetRateLimitForTests();
  const base = 1_700_000_000_000;
  const attempt = (forgedPrefix, nowMs) =>
    checkRateLimit({
      namespace: "test-forged-xff",
      ip: requestIpFromHeaders(
        new Headers({
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": `${forgedPrefix}, 203.0.113.9`,
        }),
      ),
      maxRequests: 2,
      windowMs: 60_000,
      nowMs,
    });

  assert.equal(attempt("10.0.0.1", base).ok, true);
  assert.equal(attempt("10.0.0.2", base + 1).ok, true);
  // A third request with yet another forged prefix still lands in the
  // same bucket, so it is blocked.
  assert.equal(attempt("10.0.0.3", base + 2).ok, false);
});
