import assert from "node:assert/strict";
import { test } from "node:test";
import { encode } from "next-auth/jwt";

import {
  isStagingStaticShellAuthorized,
  parseAllowedGithubUsers,
  readSessionCookie,
} from "../cloudflare/staging-static-auth.mjs";

const SECRET = "test-secret-with-enough-entropy-for-nextauth";

async function makeCookie(login, maxAge = 60) {
  const token = await encode({
    token: { login },
    secret: SECRET,
    maxAge,
  });
  return `__Secure-next-auth.session-token=${encodeURIComponent(token)}`;
}

function req(cookie) {
  return new Request("https://staging.example.com/blog", {
    headers: cookie ? { cookie } : {},
  });
}

test("staging static auth accepts a valid allowed NextAuth session", async () => {
  const cookie = await makeCookie("Jinnkunn");
  const ok = await isStagingStaticShellAuthorized(req(cookie), {
    NEXTAUTH_SECRET: SECRET,
    SITE_ADMIN_GITHUB_USERS: "other, @jinnkunn",
  });
  assert.equal(ok, true);
});

test("staging static auth reconstructs chunked NextAuth cookies", async () => {
  const cookie = await makeCookie("jinnkunn");
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));
  const left = token.slice(0, Math.ceil(token.length / 2));
  const right = token.slice(Math.ceil(token.length / 2));
  const chunked = `__Secure-next-auth.session-token.0=${left}; __Secure-next-auth.session-token.1=${right}`;
  assert.equal(readSessionCookie(chunked), token);
  const ok = await isStagingStaticShellAuthorized(req(chunked), {
    NEXTAUTH_SECRET: SECRET,
    SITE_ADMIN_GITHUB_USERS: "jinnkunn",
  });
  assert.equal(ok, true);
});

test("staging static auth rejects invalid, expired, and disallowed sessions", async () => {
  assert.equal(
    await isStagingStaticShellAuthorized(req("next-auth.session-token=invalid"), {
      NEXTAUTH_SECRET: SECRET,
      SITE_ADMIN_GITHUB_USERS: "jinnkunn",
    }),
    false,
  );

  assert.equal(
    await isStagingStaticShellAuthorized(req(await makeCookie("someone-else")), {
      NEXTAUTH_SECRET: SECRET,
      SITE_ADMIN_GITHUB_USERS: "jinnkunn",
    }),
    false,
  );

  assert.equal(
    await isStagingStaticShellAuthorized(req(await makeCookie("jinnkunn", -60)), {
      NEXTAUTH_SECRET: SECRET,
      SITE_ADMIN_GITHUB_USERS: "jinnkunn",
    }),
    false,
  );
});

test("parseAllowedGithubUsers normalizes case, commas, newlines, and @ prefixes", () => {
  assert.deepEqual([...parseAllowedGithubUsers(" @Jinnkunn,\nOther ")], [
    "jinnkunn",
    "other",
  ]);
});
