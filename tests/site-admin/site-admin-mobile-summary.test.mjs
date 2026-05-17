import test from "node:test";
import assert from "node:assert/strict";

import { parseSiteAdminAppRedirectUri } from "../../lib/site-admin/app-auth-redirect.ts";
import { buildSiteAdminMobileSummary } from "../../lib/site-admin/mobile-summary.ts";

function status(overrides = {}) {
  return {
    ok: true,
    env: { runtimeProvider: "cloudflare" },
    build: { branch: "main" },
    content: { siteName: "jinkunchen.com" },
    source: {
      storeKind: "db",
      branch: "main",
      contentBranch: "main",
      codeSha: "abcdef1234567890",
      contentSha: "123456abcdef7890",
      pendingDeploy: false,
      deployableVersionReady: true,
      ...overrides,
    },
  };
}

test("mobile summary: reports current site state as a compact payload", () => {
  const summary = buildSiteAdminMobileSummary({
    generatedAt: "2026-05-16T12:00:00.000Z",
    status: status(),
    now: {
      current: {
        text: "Polishing the mobile admin companion.",
        context: "Site Admin",
        location: "Halifax",
        updatedAt: "2026-05-16T11:00:00.000Z",
      },
      updates: [{ id: "1", text: "Earlier", at: "2026-05-16T10:00:00.000Z" }],
      links: [],
    },
    calendar: {
      generatedAt: "2026-05-16T10:30:00.000Z",
      eventCount: 7,
      rangeStartsAt: "2026-05-01T00:00:00.000Z",
      rangeEndsAt: "2026-06-01T00:00:00.000Z",
    },
    content: { posts: 8, pages: 12 },
  });

  assert.equal(summary.generatedAt, "2026-05-16T12:00:00.000Z");
  assert.equal(summary.now.text, "Polishing the mobile admin companion.");
  assert.equal(summary.calendar.eventCount, 7);
  assert.equal(summary.content.posts, 8);
  assert.equal(summary.release.recommendedAction.kind, "noop");
  assert.equal(summary.source.codeSha, "abcdef1");
});

test("mobile summary: recommends smart release when source is ahead", () => {
  const summary = buildSiteAdminMobileSummary({
    status: status({ pendingDeploy: true, pendingDeployReason: "content changed" }),
  });

  assert.equal(summary.release.headline, "Release needed");
  assert.equal(summary.release.recommendedAction.kind, "smart-release");
  assert.equal(summary.release.recommendedAction.label, "Smart Release");
});

test("mobile summary: surfaces active release job before any new action", () => {
  const summary = buildSiteAdminMobileSummary({
    status: status({ pendingDeploy: true }),
    jobs: [
      {
        id: "job_1",
        action: "smart-release",
        script: "release:site",
        target: "production",
        status: "running",
        phase: "build",
        createdAt: 1,
        updatedAt: 2,
        finishedAt: null,
        error: "",
      },
    ],
  });

  assert.equal(summary.release.recommendedAction.kind, "watch-release");
  assert.equal(summary.release.runningJob?.id, "job_1");
  assert.equal(summary.release.latestJob?.id, "job_1");
});

test("app auth redirect: allows localhost and the fixed iOS callback only", () => {
  assert.ok(parseSiteAdminAppRedirectUri("http://127.0.0.1:49152/callback"));
  assert.ok(parseSiteAdminAppRedirectUri("jinnkunn-site-admin://auth/callback"));
  assert.equal(parseSiteAdminAppRedirectUri("https://example.com/callback"), null);
  assert.equal(parseSiteAdminAppRedirectUri("jinnkunn-site-admin://evil/callback"), null);
  assert.equal(parseSiteAdminAppRedirectUri("other-app://auth/callback"), null);
});
