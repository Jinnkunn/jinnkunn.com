import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  isStaticProtectionSatisfied,
  pickStaticProtectedRule,
} from "../../cloudflare/static-shell-protection.mjs";
import { parseCookieHeader } from "../../cloudflare/staging-static-auth.mjs";
import { computeProtectedRouteCookie } from "../../cloudflare/protected-route-cookie.mjs";

const POLICY = {
  rules: [
    {
      id: "path-rule",
      key: "path",
      path: "/teaching/archive/2024-25-fall/csci3141",
      mode: "prefix",
      auth: "password",
      token: "secret-token",
    },
    {
      id: "page-rule",
      key: "pageId",
      pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      path: "/unused",
      mode: "prefix",
      auth: "password",
      token: "page-token",
    },
  ],
  routesMap: {
    "/teaching/archive": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "/teaching/archive/2024-25-fall": "cccccccccccccccccccccccccccccccc",
    "/private-page": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  parentByPageId: {
    cccccccccccccccccccccccccccccccc: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: "",
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: "",
  },
};

test("static shell protection matches path protected routes", () => {
  const rule = pickStaticProtectedRule(
    "/teaching/archive/2024-25-fall/csci3141/syllabus",
    POLICY,
  );
  assert.equal(rule?.id, "path-rule");
});

test("static shell protection matches pageId protected routes", () => {
  const rule = pickStaticProtectedRule("/private-page", POLICY);
  assert.equal(rule?.id, "page-rule");
});

test("static shell protection allows password rule only with the HMAC cookie", async () => {
  const secret = "test-protected-route-secret";
  const rule = pickStaticProtectedRule("/private-page", POLICY);
  const cookie = await computeProtectedRouteCookie(rule.id, secret);
  assert.ok(cookie);
  assert.equal(
    await isStaticProtectionSatisfied(
      rule,
      `site_auth_page-rule=${cookie}`,
      parseCookieHeader,
      secret,
    ),
    true,
  );
  // The stored verifier (rule.token) must NOT be replayable as a cookie.
  assert.equal(
    await isStaticProtectionSatisfied(
      rule,
      `site_auth_page-rule=${rule.token}`,
      parseCookieHeader,
      secret,
    ),
    false,
  );
  assert.equal(
    await isStaticProtectionSatisfied(
      rule,
      "site_auth_page-rule=wrong",
      parseCookieHeader,
      secret,
    ),
    false,
  );
  // No secret configured -> fail closed even with an otherwise-valid cookie.
  assert.equal(
    await isStaticProtectionSatisfied(
      rule,
      `site_auth_page-rule=${cookie}`,
      parseCookieHeader,
      "",
    ),
    false,
  );
});

test("static shell protection does not match unrelated routes", () => {
  assert.equal(pickStaticProtectedRule("/teaching/archive", POLICY), null);
});

test("static shell protection includes the published CSCI3141 password route", async () => {
  const rules = JSON.parse(await fs.readFile("content/filesystem/protected-routes.json", "utf8"));
  const rule = pickStaticProtectedRule("/teaching/archive/2024-25-fall/csci3141", {
    rules,
    routesMap: {},
    parentByPageId: {},
  });
  assert.equal(rule?.path, "/teaching/archive/2024-25-fall/csci3141");
  assert.equal(rule?.auth, "password");
  assert.ok(rule?.token);
});
