import test from "node:test";
import assert from "node:assert/strict";

import {
  issueSiteAdminAppToken,
  verifySiteAdminAppToken,
} from "../lib/server/site-admin-app-token.ts";

const ORIGINAL_SITE_ADMIN_APP_TOKEN_SECRET = process.env.SITE_ADMIN_APP_TOKEN_SECRET;
const ORIGINAL_NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

function withTokenSecret(value, run) {
  process.env.SITE_ADMIN_APP_TOKEN_SECRET = value;
  process.env.NEXTAUTH_SECRET = "";
  process.env.AUTH_SECRET = "";
  try {
    run();
  } finally {
    process.env.SITE_ADMIN_APP_TOKEN_SECRET = ORIGINAL_SITE_ADMIN_APP_TOKEN_SECRET;
    process.env.NEXTAUTH_SECRET = ORIGINAL_NEXTAUTH_SECRET;
    process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  }
}

test("site-admin app token: issue + verify roundtrip", () => {
  withTokenSecret("test-site-admin-app-secret", () => {
    const issued = issueSiteAdminAppToken("JinnKunn", { ttlSeconds: 120 });
    assert.ok(issued.token.includes("."), "token should be jwt-like");
    assert.ok(issued.expiresAt, "expiresAt should be present");

    const verified = verifySiteAdminAppToken(issued.token);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.login, "jinnkunn");
    assert.ok(verified.expiresAt);
  });
});

test("site-admin app token: invalid signature is rejected", () => {
  withTokenSecret("test-site-admin-app-secret", () => {
    const issued = issueSiteAdminAppToken("jinnkunn");
    const tampered = `${issued.token}tampered`;
    const verified = verifySiteAdminAppToken(tampered);
    assert.equal(verified.ok, false);
  });
});

test("site-admin app token: missing secret fails fast", () => {
  process.env.SITE_ADMIN_APP_TOKEN_SECRET = "";
  process.env.NEXTAUTH_SECRET = "";
  process.env.AUTH_SECRET = "";
  try {
    assert.throws(
      () => issueSiteAdminAppToken("jinnkunn"),
      /SITE_ADMIN_APP_TOKEN_SECRET or NEXTAUTH_SECRET is required/,
    );
    const verified = verifySiteAdminAppToken("abc.def.ghi");
    assert.equal(verified.ok, false);
  } finally {
    process.env.SITE_ADMIN_APP_TOKEN_SECRET = ORIGINAL_SITE_ADMIN_APP_TOKEN_SECRET;
    process.env.NEXTAUTH_SECRET = ORIGINAL_NEXTAUTH_SECRET;
    process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  }
});

