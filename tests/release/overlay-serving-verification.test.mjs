import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { overlayVerificationTargets, verifyOverlayContent } from "../../scripts/_lib/overlay-serving-verification.mjs";

const sha = (body) => crypto.createHash("sha1").update(body).digest("hex");
const row = (route, body = `<main>${route} new content</main>`) => ({
  asset_path: `/__static${route === "/" ? "/index" : route}.html`, body, content_sha: sha(body),
});
const rows = [row("/"), row("/news"), row("/teaching"), row("/works"), row("/publications"), row("/blog/paper")];
function response(target, body = target.body, extra = {}) {
  return new Response(body, { headers: {
    "x-static-shell": "1", "x-static-overlay": "1", "x-static-shell-path": target.asset_path,
    etag: `"${target.content_sha}"`, ...extra,
  } });
}
const resolve = (url) => rows.find((target) => target.asset_path === `/__static${new URL(url).pathname === "/" ? "/index" : new URL(url).pathname}.html`);

test("publish verifies the actual bytes of every public collection and blog page", async () => {
  const checked = [];
  const result = await verifyOverlayContent({ origin: "https://example.test", rows, fetchImpl: async (url) => {
    checked.push(new URL(url).pathname);
    return response(resolve(url));
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(checked.sort(), ["/", "/blog/paper", "/news", "/publications", "/teaching", "/works"]);
  assert.ok(result.routes.every((item) => item.actualSha === item.expectedSha));
});

test("200 with overlay headers and a current ETag cannot pass with old content", async () => {
  await assert.rejects(verifyOverlayContent({ origin: "https://example.test", rows, attempts: 1,
    fetchImpl: async (url) => response(resolve(url), new URL(url).pathname === "/works" ? "old work" : resolve(url).body),
  }), /Overlay content verification failed.*\/works/);
});

test("accepts matching response bytes when a CDN omits or weakens the ETag", async () => {
  const target = row("/");
  for (const etag of ["", `W/"${target.content_sha}"`]) {
    const result = await verifyOverlayContent({ origin: "https://example.test", rows: [target], attempts: 1,
      fetchImpl: async () => response(target, target.body, { etag }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.routes[0].actualSha, target.content_sha);
  }
});

test("missing ETag never lets stale response bytes pass", async () => {
  const target = row("/");
  await assert.rejects(verifyOverlayContent({ origin: "https://example.test", rows: [target], attempts: 1,
    fetchImpl: async () => response(target, "old content", { etag: "" }),
  }), /Overlay content verification failed/);
});

test("retries stale pages only and tolerates a temporary network failure", async () => {
  const calls = new Map();
  const result = await verifyOverlayContent({ origin: "https://example.test", rows, wait: async () => {},
    fetchImpl: async (url, options) => {
      assert.ok(options.signal);
      const path = new URL(url).pathname;
      calls.set(path, (calls.get(path) || 0) + 1);
      if (path === "/news" && calls.get(path) === 1) throw new Error("offline");
      if (path === "/teaching" && calls.get(path) === 1) return response(resolve(url), "old");
      return response(resolve(url));
    },
  });
  assert.equal(result.attempts, 2);
  assert.equal(calls.get("/works"), 1);
  assert.equal(calls.get("/news"), 2);
});

test("skips protected and runtime-only routes; includes nested pages and aliases", () => {
  const policy = { rules: [{ id: "private", key: "path", path: "/private", mode: "prefix" }], routesMap: {}, parentByPageId: {} };
  const targets = overlayVerificationTargets([...rows, row("/blog/list"), row("/pages/bio"), row("/private/child"), row("/site-admin"), row("/auth/signin"), row("/abc.pdf"), row("/0123456789abcdef0123456789abcdef"),
    { asset_path: "/__static/protected-routes-policy.json", body: JSON.stringify(policy) },
  ]);
  assert.ok(!targets.some((target) => target.path === "/blog/list"));
  assert.ok(!targets.some((target) => target.path === "/private/child"));
  assert.ok(!targets.some((target) => /site-admin|auth|abc\.pdf|0123456789abcdef/.test(target.path)));
  assert.ok(targets.some((target) => target.path === "/pages/bio"));
});

test("follows Worker asset priority for nested index aliases", () => {
  const index = row("/works/index", "nested fallback");
  for (const candidates of [[index, ...rows], [...rows, index]]) {
    const target = overlayVerificationTargets(candidates).find((item) => item.path === "/works");
    assert.equal(target.assetPath, "/__static/works.html");
    assert.equal(target.expectedSha, row("/works").content_sha);
  }
});

test("matching bytes still fail with an incorrect served path or fingerprint header", async () => {
  for (const extra of [{ etag: '"stale"' }, { "x-static-shell-path": "/__static/old.html" }, { "x-static-overlay": "" }]) {
    await assert.rejects(verifyOverlayContent({ origin: "https://example.test", rows: [row("/")], attempts: 1,
      fetchImpl: async () => response(row("/"), row("/").body, extra),
    }), /Overlay content verification failed/);
  }
});

test("rejects corrupt overlay metadata and missing homepage instead of passing vacuously", () => {
  assert.throws(() => overlayVerificationTargets([{ ...row("/"), content_sha: "wrong" }]), /fingerprint/);
  assert.throws(() => overlayVerificationTargets([row("/news")]), /homepage/);
});
