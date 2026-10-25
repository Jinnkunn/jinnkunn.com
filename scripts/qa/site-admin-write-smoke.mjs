#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";

export function writeSmokeTarget(args, environment = {}) {
  const env = args.find((arg) => arg.startsWith("--env="))?.slice(6) || "staging";
  assert.equal(env, "staging", "Write smoke tests may only target staging, never production.");
  const origin = new URL(environment.BASE_URL || "https://staging.jinkunchen.com");
  assert.equal(origin.hostname, "staging.jinkunchen.com", "Use the dedicated staging host.");
  assert.equal(origin.protocol, "https:");
  assert.equal(origin.port, "");
  assert.equal(origin.username + origin.password + origin.search + origin.hash, "");
  assert.equal(origin.pathname, "/");
  return { origin: origin.origin, execute: args.includes("--execute") };
}

export function assertIsolatedReview(review, ownedPath) {
  assert.ok(Array.isArray(review.changes), "Publication review is unavailable.");
  assert.ok(review.changes.every((change) => change.path === ownedPath && !change.oldPath), "Other saved drafts are pending. Refusing to publish unrelated content.");
  assert.equal(review.validation?.blockers?.length || 0, 0, "Publication validation failed.");
  assert.match(review.snapshotSha, /^[a-f0-9]{64}$/);
}

async function main() {
  // Validate the destination before loading credentials or making any request.
  const target = writeSmokeTarget(process.argv.slice(2), process.env);
  loadProjectEnv({ override: false });
  const auth = await createNextAuthSessionCookie({ subjectPrefix: "d1-write-smoke", maxAge: 1800 });
  assert.equal(auth.ok, true, "A staging admin session is required.");
  const request = async (path, method = "GET", body) => {
    const response = await fetch(`${target.origin}${path}`, {
      method, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000),
      headers: { cookie: auth.cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, data: json?.data ?? json, code: json?.code };
  };
  const read = async (path) => { const result = await request(path); assert.equal(result.ok, true, `${path}: HTTP ${result.status}`); return result.data; };
  const baseline = await read("/api/site-admin/publication-review");
  assertIsolatedReview(baseline, "");
  const jobs = await read("/api/site-admin/release-jobs?limit=30");
  assert.equal(jobs.jobs.some((job) => ["queued", "running"].includes(job.status)), false, "A release is already active.");
  const status = await read("/api/site-admin/status");
  assert.equal(status.source?.storeKind, "db", "Staging must use D1.");
  if (!target.execute) {
    console.log(JSON.stringify({ ok: true, mode: "read-only", writes: 0, target: target.origin, snapshotSha: baseline.snapshotSha, next: "Pass --execute to create, publish, verify and remove one isolated staging test post." }));
    return;
  }
  const slug = `qa-publish-${randomUUID()}`, path = `posts/${slug}.mdx`, endpoint = `/api/site-admin/posts/${slug}`;
  const title = `Publication QA ${slug}`, marker = randomUUID();
  let version = "", activeJob = "", publicAttempted = false;
  const waitForJob = async (id) => {
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until) {
      const data = await read(`/api/site-admin/release-jobs/${id}`), job = data.job ?? data;
      if (["succeeded", "failed", "canceled"].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error(`Release ${id} did not finish. Inspect it before retrying; no duplicate job was queued.`);
  };
  const publish = async () => {
    const review = await read("/api/site-admin/publication-review");
    assertIsolatedReview(review, path);
    if (!review.changes.length) return;
    const result = await request("/api/site-admin/release-jobs", "POST", { action: "publish-content-staging", request: { reviewSnapshotSha: review.snapshotSha, origin: "isolated-d1-write-smoke" } });
    assert.equal(result.status, 202, `Publication rejected (${result.status}, ${result.code || "unknown"}).`);
    activeJob = result.data.job.id;
    const job = await waitForJob(activeJob);
    activeJob = "";
    assert.equal(job.status, "succeeded", `Release ${job.id} ${job.status}. Inspect release events before retrying.`);
  };
  const publicText = async (pathname) => {
    const response = await fetch(`${target.origin}${pathname}`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000), headers: { cookie: auth.cookie } });
    return { status: response.status, body: await response.text(), overlay: response.headers.get("x-static-overlay") };
  };
  try {
    const incomplete = '---\ntitle: ""\ndate: ""\ndraft: true\n---\n';
    const created = await request("/api/site-admin/posts", "POST", { slug, source: incomplete });
    assert.equal(created.status, 201); version = created.data.version;
    assert.equal((await read(endpoint)).source, incomplete, "Incomplete draft must survive a real D1 round-trip.");
    const source = `---\ntitle: ${JSON.stringify(title)}\ndate: ${new Date().toISOString().slice(0, 10)}\ndraft: false\n---\n\n${marker}\n`;
    const saved = await request(endpoint, "PATCH", { source, version });
    assert.equal(saved.status, 200); const staleVersion = version; version = saved.data.version;
    const conflict = await request(endpoint, "PATCH", { source: incomplete, version: staleVersion });
    assert.equal(conflict.status, 409); assert.equal(conflict.code, "SOURCE_CONFLICT");
    assert.equal((await read(endpoint)).source, source, "A rejected stale write cannot change the saved draft.");
    publicAttempted = true;
    await publish();
    const page = await publicText(`/blog/${slug}`);
    assert.equal(page.status, 200); assert.equal(page.overlay, "1"); assert.ok(page.body.includes(marker));
    assert.ok((await publicText("/blog")).body.includes(title));
    assert.ok(JSON.stringify(await read(`/api/search?q=${encodeURIComponent(title)}`)).includes(slug));
    console.log(JSON.stringify({ ok: true, stage: "published", slug, conflict: "rejected", publicHtml: "verified", search: "verified" }));
  } finally {
    // Do not race an uncertain runner or overwrite another session's version.
    if (activeJob) {
      console.error(`Cleanup deferred: inspect release ${activeJob} and test post ${path}; a runner may still hold its snapshot.`);
      process.exitCode = 1;
    } else if (version) {
      const removed = await request(endpoint, "DELETE", { version });
      assert.equal(removed.status, 200, `Cleanup conflict for ${path}; no other version was removed.`);
      if (publicAttempted) {
        await publish();
        assert.equal((await publicText(`/blog/${slug}`)).status, 404);
        assert.equal(JSON.stringify(await read(`/api/search?q=${encodeURIComponent(title)}`)).includes(slug), false);
      }
      assert.equal((await request(endpoint)).status, 404);
      console.log(JSON.stringify({ ok: true, stage: "cleaned", slug }));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => { console.error(`[d1-write-smoke] ${error.message}`); process.exitCode = 1; });
}
