import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  computeProtectedRouteCookie as cookieMjs,
  timingSafeEqualHex as eqMjs,
} from "../../cloudflare/protected-route-cookie.mjs";
import {
  computeProtectedRouteCookie as cookieTs,
  timingSafeEqualHex as eqTs,
} from "../../lib/shared/protected-route-cookie.ts";
import {
  hashProtectedRoutePassword,
  isScryptVerifier,
  verifyProtectedRoutePassword,
} from "../../lib/server/protected-route-password.ts";

test("cookie is HMAC-SHA256(secret, 'v1:site-auth:'+id) and TS/MJS agree", async () => {
  const secret = "s3cr3t-value";
  const id = "2c471c63bb05fa6f80bcce5d73f7bb60";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`v1:site-auth:${id}`)
    .digest("hex");
  assert.equal(await cookieMjs(id, secret), expected);
  assert.equal(await cookieTs(id, secret), expected);
});

test("cookie derivation fails closed without a secret or id", async () => {
  assert.equal(await cookieMjs("route-1", ""), "");
  assert.equal(await cookieTs("route-1", ""), "");
  assert.equal(await cookieMjs("", "secret"), "");
  assert.equal(await cookieTs("", "secret"), "");
});

test("timingSafeEqualHex rejects empty and mismatched inputs", () => {
  for (const eq of [eqMjs, eqTs]) {
    assert.equal(eq("", ""), false);
    assert.equal(eq("abcd", ""), false);
    assert.equal(eq("abcd", "abcd"), true);
    assert.equal(eq("abcd", "abce"), false);
    assert.equal(eq("abcd", "abcde"), false);
  }
});

test("password verifier uses scrypt with a random per-call salt and round-trips", () => {
  const v1 = hashProtectedRoutePassword("open-sesame");
  const v2 = hashProtectedRoutePassword("open-sesame");
  assert.ok(isScryptVerifier(v1));
  assert.ok(v1.startsWith("scrypt$v1$"));
  assert.notEqual(v1, v2, "random salt should make identical passwords hash differently");
  assert.equal(verifyProtectedRoutePassword("open-sesame", v1, "/ignored"), true);
  assert.equal(verifyProtectedRoutePassword("wrong", v1, "/ignored"), false);
});

test("legacy sha256(path\\npassword) verifiers still validate", () => {
  const routePath = "/teaching/archive/2024-25-fall/csci3141";
  const legacy = crypto
    .createHash("sha256")
    .update(`${routePath}\nhunter2`, "utf8")
    .digest("hex");
  assert.equal(verifyProtectedRoutePassword("hunter2", legacy, routePath), true);
  assert.equal(verifyProtectedRoutePassword("nope", legacy, routePath), false);
});

test("the rotate-pending placeholder verifier never validates", () => {
  assert.equal(verifyProtectedRoutePassword("anything", "__rotate_pending__", "/x"), false);
  assert.equal(verifyProtectedRoutePassword("", "__rotate_pending__", "/x"), false);
});
