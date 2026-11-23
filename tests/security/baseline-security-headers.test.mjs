import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BASELINE_SECURITY_HEADERS,
  withBaselineSecurityHeaders,
} from "../../lib/shared/security-headers.mjs";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("baseline headers are added to an edge response that has none", async () => {
  const original = new Response("<h1>Home</h1>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "x-static-overlay": "1" },
  });
  const hardened = withBaselineSecurityHeaders(original);
  for (const [name, value] of BASELINE_SECURITY_HEADERS) {
    assert.equal(hardened.headers.get(name), value, name);
  }
  assert.equal(hardened.status, 200);
  assert.equal(hardened.headers.get("x-static-overlay"), "1");
  assert.equal(hardened.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(await hardened.text(), "<h1>Home</h1>");
});

test("headers a response already sets are kept, and complete responses pass through", () => {
  const strict = new Response(null, { status: 404, statusText: "Not Found", headers: { "X-Frame-Options": "DENY" } });
  const hardened = withBaselineSecurityHeaders(strict);
  assert.equal(hardened.headers.get("x-frame-options"), "DENY");
  assert.equal(hardened.status, 404);
  assert.equal(hardened.statusText, "Not Found");

  assert.equal(withBaselineSecurityHeaders(hardened), hardened);
});

test("immutable-header responses are copied instead of mutated", () => {
  // Response.redirect(), like fetch()/env.ASSETS.fetch() results, has an
  // immutable header guard; mutating it in place would throw.
  const redirect = Response.redirect("https://jinkunchen.com/rss.xml", 301);
  const hardened = withBaselineSecurityHeaders(redirect);
  assert.notEqual(hardened, redirect);
  assert.equal(hardened.status, 301);
  assert.equal(hardened.headers.get("location"), "https://jinkunchen.com/rss.xml");
  assert.equal(hardened.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains; preload");
});

test("the obsolete FLoC opt-out is not sent", () => {
  const permissions = new Map(BASELINE_SECURITY_HEADERS).get("Permissions-Policy");
  assert.doesNotMatch(permissions, /interest-cohort/);
});

test("Worker, Next config, and asset _headers share one baseline list", async () => {
  const [worker, nextConfig, exporter] = await Promise.all([
    source("cloudflare/worker-entry.mjs"),
    source("next.config.mjs"),
    source("scripts/build/export-static-shell-assets.mjs"),
  ]);

  // Every response the Worker builds itself (static shells, D1 overlays, edge
  // 404/503s) leaves through a single hardened exit before OpenNext is tried.
  assert.match(
    worker,
    /const edgeResponse = await respondAtEdge\(request, env\);[\s\S]*?if \(edgeResponse\) return withBaselineSecurityHeaders\(edgeResponse\);\s*return openNextWorker\.fetch\(request, env, ctx\);/,
  );
  assert.equal(worker.match(/openNextWorker\.fetch\(/g)?.length, 1);

  assert.match(nextConfig, /import \{ BASELINE_SECURITY_HEADERS \} from "\.\/lib\/shared\/security-headers\.mjs"/);
  assert.match(nextConfig, /BASELINE_SECURITY_HEADERS\.map/);
  assert.doesNotMatch(nextConfig, /interest-cohort/);

  assert.match(exporter, /BASELINE_SECURITY_HEADERS/);
  // A header repeated in a path-specific rule is sent twice alongside `/*`.
  assert.doesNotMatch(exporter, /X-Content-Type-Options: nosniff/);
});
