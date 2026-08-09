import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { importServerModule } from "../helpers/server-module-hooks.mjs";

const { checkSameSiteRequest } = await importServerModule("lib/server/request-guards.ts");

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const AUTHORIZE_ROUTE = path.join(
  ROOT,
  "app/api/site-admin/app-auth/authorize/route.ts",
);

const AUTHORIZE_URL =
  "https://jinkunchen.com/api/site-admin/app-auth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A5311%2Fcallback&state=abc";

function request(headers) {
  return new Request(AUTHORIZE_URL, { headers });
}

test("cross-site: a request initiated by another site is refused", () => {
  const out = checkSameSiteRequest(
    request({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }),
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, "cross-site");
});

test("cross-site: same-site (sibling subdomain) is refused too", () => {
  const out = checkSameSiteRequest(request({ "sec-fetch-site": "same-site" }));
  assert.equal(out.ok, false);
});

test("cross-site: a mismatched Origin is refused even without fetch metadata", () => {
  const out = checkSameSiteRequest(request({ origin: "https://evil.example" }));
  assert.equal(out.ok, false);
  assert.equal(out.reason, "origin-mismatch");
});

test("cross-site: a mismatched Referer is refused", () => {
  const out = checkSameSiteRequest(request({ referer: "https://evil.example/page" }));
  assert.equal(out.ok, false);
  assert.equal(out.reason, "origin-mismatch");
});

test("cross-site: an opaque `Origin: null` is refused, not treated as absent", () => {
  // Sandboxed frames and cross-origin redirects send the literal string
  // "null"; skipping it would hand those the same pass as a CLI client.
  const out = checkSameSiteRequest(request({ origin: "null" }));
  assert.equal(out.ok, false);
  assert.equal(out.reason, "origin-mismatch");
});

test("cross-site: the desktop-app flow (browser opened directly) is allowed", () => {
  // A browser opened from a native app sends `none` and no Origin.
  assert.equal(checkSameSiteRequest(request({ "sec-fetch-site": "none" })).ok, true);
});

test("cross-site: same-origin navigation from the admin UI is allowed", () => {
  const out = checkSameSiteRequest(
    request({
      "sec-fetch-site": "same-origin",
      origin: "https://jinkunchen.com",
      referer: "https://jinkunchen.com/site-admin",
    }),
  );
  assert.equal(out.ok, true);
});

test("cross-site: forwarded host is accepted as our own origin behind a proxy", () => {
  const req = new Request("http://127.0.0.1:8787/api/site-admin/app-auth/authorize", {
    headers: {
      "sec-fetch-site": "same-origin",
      "x-forwarded-host": "jinkunchen.com",
      "x-forwarded-proto": "https",
      origin: "https://jinkunchen.com",
    },
  });
  assert.equal(checkSameSiteRequest(req).ok, true);
});

test("cross-site: non-browser clients with no metadata still pass", () => {
  assert.equal(checkSameSiteRequest(request({})).ok, true);
});

test("authorize route: consults the same-site guard and audits every token issue", () => {
  const source = fs.readFileSync(AUTHORIZE_ROUTE, "utf8");
  assert.match(source, /checkSameSiteRequest\(req\)/);
  assert.match(source, /action: "app-auth\.token\.issue"/);
  assert.match(source, /action: "auth\.denied"/);

  // The guard must run before the token is minted, not after.
  assert.ok(
    source.indexOf("checkSameSiteRequest(req)") < source.indexOf("issueSiteAdminAppToken("),
    "cross-site check must precede token issuance",
  );
});
