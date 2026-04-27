import assert from "node:assert/strict";
import test from "node:test";

import {
  isStaticProtectionSatisfied,
  pickStaticProtectedRule,
} from "../cloudflare/static-shell-protection.mjs";
import { parseCookieHeader } from "../cloudflare/staging-static-auth.mjs";

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

test("static shell protection allows password rule only with matching cookie", () => {
  const rule = pickStaticProtectedRule("/private-page", POLICY);
  assert.equal(
    isStaticProtectionSatisfied(rule, "site_auth_page-rule=page-token", parseCookieHeader),
    true,
  );
  assert.equal(
    isStaticProtectionSatisfied(rule, "site_auth_page-rule=wrong", parseCookieHeader),
    false,
  );
});

test("static shell protection does not match unrelated routes", () => {
  assert.equal(pickStaticProtectedRule("/teaching/archive", POLICY), null);
});
