import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { authorizeDeployRequest, verifyDeploySignature } from "../lib/server/deploy-auth.ts";

function sign(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

function buildRequest({ ip, ts, sig }) {
  return new Request("https://example.com/api/deploy", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      "x-deploy-ts": ts,
      "x-deploy-signature": `sha256=${sig}`,
    },
  });
}

test("deploy-auth: verifyDeploySignature accepts valid sha256 signature", () => {
  const secret = "deploy-secret";
  const body = "{\"ok\":true}";
  const ts = "1700000000";
  const sig = sign(secret, ts, body);

  assert.equal(
    verifyDeploySignature({
      secret,
      timestamp: ts,
      rawBody: body,
      signature: `sha256=${sig}`,
    }),
    true,
  );
});

test("deploy-auth: authorizeDeployRequest rejects missing signature headers", () => {
  const req = new Request("https://example.com/api/deploy", { method: "POST" });
  const out = authorizeDeployRequest(req, "{}", "deploy-secret", 1_700_000_000_000);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.status, 401);
});

test("deploy-auth: authorizeDeployRequest rejects expired timestamp", () => {
  const secret = "deploy-secret";
  const body = "{}";
  const nowMs = 1_700_000_000_000;
  const staleTs = String(Math.floor((nowMs - 10 * 60 * 1000) / 1000));
  const req = buildRequest({
    ip: "203.0.113.41",
    ts: staleTs,
    sig: sign(secret, staleTs, body),
  });

  const out = authorizeDeployRequest(req, body, secret, nowMs);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.status, 401);
});

test("deploy-auth: authorizeDeployRequest rejects invalid signature", () => {
  const secret = "deploy-secret";
  const body = "{}";
  const nowMs = 1_700_000_000_000;
  const ts = String(Math.floor(nowMs / 1000));
  const req = buildRequest({
    ip: "203.0.113.42",
    ts,
    sig: sign(secret, ts, "{\"tampered\":true}"),
  });

  const out = authorizeDeployRequest(req, body, secret, nowMs);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.status, 401);
});

test("deploy-auth: authorizeDeployRequest rate-limits repeated requests from same ip", () => {
  const secret = "deploy-secret";
  const body = "{}";
  const nowMs = 1_700_000_000_000;
  const ts = String(Math.floor(nowMs / 1000));
  const sig = sign(secret, ts, body);
  const ip = "203.0.113.99";

  for (let i = 0; i < 10; i++) {
    const req = buildRequest({ ip, ts, sig });
    const out = authorizeDeployRequest(req, body, secret, nowMs);
    assert.equal(out.ok, true);
  }

  const blocked = authorizeDeployRequest(buildRequest({ ip, ts, sig }), body, secret, nowMs);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.status, 429);
  assert.equal(typeof blocked.retryAfterSec, "number");
  assert.equal((blocked.retryAfterSec || 0) > 0, true);
});
