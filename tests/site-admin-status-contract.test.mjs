import test from "node:test";
import assert from "node:assert/strict";

import {
  isSiteAdminStatusOk,
  parseSiteAdminStatusResult,
} from "../lib/site-admin/status-contract.ts";

function makeStat(overrides = {}) {
  return { exists: true, mtimeMs: 1, size: 2, count: 3, ...overrides };
}

function makeValidPayload(overrides = {}) {
  return {
    ok: true,
    env: {
      nodeEnv: "production",
      runtimeProvider: "cloudflare",
      runtimeRegion: "iad",
      hasDeployTarget: true,
      isVercel: false,
      vercelRegion: "",
      hasNotionToken: true,
      hasNotionAdminPageId: true,
      notionVersion: "2022-06-28",
      hasDeployHookUrl: true,
      hasNextAuthSecret: true,
      hasFlagsSecret: true,
      githubAllowlistCount: 2,
      contentGithubAllowlistCount: 3,
    },
    build: {
      provider: "cloudflare",
      commitSha: "abc",
      commitShort: "abc1234",
      branch: "main",
      commitMessage: "msg",
      deploymentId: "dep",
      deploymentUrl: "https://example.workers.dev",
      vercelUrl: "",
    },
    content: {
      siteName: "Site",
      nav: { top: 4, more: 3 },
      routesDiscovered: 12,
      searchIndexItems: 30,
      syncMeta: {
        syncedAt: "2026-02-01T00:00:00.000Z",
        pages: 10,
        routes: 12,
      },
    },
    files: {
      siteConfig: makeStat(),
      routesManifest: makeStat(),
      protectedRoutes: makeStat(),
      syncMeta: makeStat(),
      searchIndex: makeStat(),
      routesJson: makeStat(),
      notionSyncCache: makeStat({ count: 12 }),
    },
    notion: {
      adminPage: {
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        lastEdited: "2026-02-01T00:00:00.000Z",
        title: "Site Admin",
      },
      rootPage: null,
    },
    source: {
      storeKind: "github",
      repo: "acme/site",
      branch: "main",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      headCommitTime: "2026-02-01T00:00:00.000Z",
      pendingDeploy: false,
      codeSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      contentSha: "0123456789abcdef0123456789abcdef01234567",
      contentBranch: "main",
      deployableVersionReady: true,
      deployableVersionId: "version-1",
    },
    deployments: {
      active: {
        deploymentId: "deployment-1",
        versionId: "version-1",
        createdOn: "2026-02-01T00:00:00.000Z",
        message: "Manual deploy source=0123456789abcdef0123456789abcdef01234567 code=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceSha: "0123456789abcdef0123456789abcdef01234567",
        codeSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        contentSha: "0123456789abcdef0123456789abcdef01234567",
        contentBranch: "main",
      },
      latestUploaded: {
        versionId: "version-2",
        createdOn: "2026-02-01T00:05:00.000Z",
        message: "Release upload source=0123456789abcdef0123456789abcdef01234567 code=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceSha: "0123456789abcdef0123456789abcdef01234567",
        codeSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        contentSha: "0123456789abcdef0123456789abcdef01234567",
        contentBranch: "main",
      },
    },
    preflight: {
      generatedFiles: {
        ok: true,
        expected: 12,
        missingRoutes: [],
      },
      routeOverrides: {
        ok: true,
        orphanPageIds: [],
        duplicatePaths: [],
      },
      navigation: {
        ok: true,
        invalidInternalHrefs: [],
      },
      notionBlocks: {
        ok: true,
        unsupportedBlockCount: 0,
        pagesWithUnsupported: 0,
        sampleRoutes: [],
      },
    },
    freshness: {
      stale: false,
      syncMs: 100,
      notionEditedMs: 99,
      generatedLatestMs: 101,
    },
    diagnostics: {
      total: 2,
      warnCount: 2,
      errorCount: 0,
      oldestAt: "2026-04-23T00:00:00.000Z",
      newestAt: "2026-04-23T00:05:00.000Z",
      recent: [
        {
          at: "2026-04-23T00:00:00.000Z",
          severity: "warn",
          source: "site-admin-audit",
          message: "D1 write failed, falling back to local file sink",
          detail: "timeout",
        },
        {
          at: "2026-04-23T00:05:00.000Z",
          severity: "warn",
          source: "site-admin-audit",
          message: "D1 write failed, falling back to local file sink",
        },
      ],
    },
    ...overrides,
  };
}

test("site-admin-status-contract: parses valid success payload", () => {
  const parsed = parseSiteAdminStatusResult(makeValidPayload());
  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminStatusOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.env.runtimeProvider, "cloudflare");
  assert.equal(parsed.env.hasDeployTarget, true);
  assert.equal(parsed.env.isVercel, false);
  assert.equal(parsed.content.nav.top, 4);
  assert.equal(parsed.files.notionSyncCache.count, 12);
  assert.equal(parsed.preflight?.generatedFiles.expected, 12);
  assert.equal(parsed.diagnostics?.total, 2);
  assert.equal(parsed.diagnostics?.warnCount, 2);
  assert.equal(parsed.diagnostics?.errorCount, 0);
  assert.equal(parsed.diagnostics?.recent.length, 2);
  assert.equal(parsed.diagnostics?.recent[0]?.detail, "timeout");
  // Second event had no detail — parser should leave the field off.
  assert.equal(parsed.diagnostics?.recent[1]?.detail, undefined);
});

test("site-admin-status-contract: diagnostics is optional, payload parses without it", () => {
  const payload = makeValidPayload();
  delete payload.diagnostics;
  const parsed = parseSiteAdminStatusResult(payload);
  assert.ok(parsed);
  if (!parsed || !isSiteAdminStatusOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.diagnostics, undefined);
});

test("site-admin-status-contract: malformed diagnostics rejects the whole payload", () => {
  const parsed = parseSiteAdminStatusResult(
    makeValidPayload({
      diagnostics: {
        total: "oops",
        warnCount: 0,
        errorCount: 0,
        oldestAt: null,
        newestAt: null,
        recent: [],
      },
    }),
  );
  assert.equal(parsed, null);
});

test("site-admin-status-contract: parses success payload in data envelope", () => {
  const payload = makeValidPayload();
  const parsed = parseSiteAdminStatusResult({
    ok: true,
    data: {
      env: payload.env,
      build: payload.build,
      content: payload.content,
      files: payload.files,
      notion: payload.notion,
      source: payload.source,
      deployments: payload.deployments,
      freshness: payload.freshness,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminStatusOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.env.runtimeProvider, "cloudflare");
  assert.equal(parsed.env.isVercel, false);
  assert.equal(parsed.content.nav.top, 4);
  assert.equal(parsed.files.notionSyncCache.count, 12);
  assert.equal(parsed.source.storeKind, "github");
  assert.equal(parsed.source.codeSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(parsed.source.contentSha, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(parsed.source.deployableVersionReady, true);
  assert.equal(parsed.deployments?.active?.versionId, "version-1");
  assert.equal(parsed.deployments?.latestUploaded?.versionId, "version-2");
});

test("site-admin-status-contract: preserves api error payload", () => {
  const parsed = parseSiteAdminStatusResult({ ok: false, error: "Unauthorized" });
  assert.deepEqual(parsed, { ok: false, error: "Unauthorized", code: "REQUEST_FAILED" });
});

test("site-admin-status-contract: rejects malformed success payload", () => {
  const parsed = parseSiteAdminStatusResult(
    makeValidPayload({
      env: {
        ...makeValidPayload().env,
        hasNotionToken: "yes",
      },
    }),
  );
  assert.equal(parsed, null);
});

test("site-admin-status-contract: accepts nullable optional sections", () => {
  const parsed = parseSiteAdminStatusResult(
    makeValidPayload({
      content: {
        ...makeValidPayload().content,
        searchIndexItems: null,
        syncMeta: null,
      },
      freshness: {
        stale: null,
        syncMs: null,
        notionEditedMs: null,
        generatedLatestMs: null,
      },
      notion: {
        adminPage: null,
        rootPage: {
          id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          lastEdited: "2026-02-02T00:00:00.000Z",
          title: "Home",
        },
      },
      source: {
        storeKind: "local",
        repo: null,
        branch: null,
        headSha: null,
        headCommitTime: null,
        pendingDeploy: null,
        pendingDeployReason: "ACTIVE_DEPLOYMENT_SOURCE_SHA_UNAVAILABLE",
        deployableVersionReady: null,
        deployableVersionReason: "LATEST_WORKER_VERSION_UNAVAILABLE",
      },
    }),
  );
  assert.ok(parsed);
  if (!parsed || !isSiteAdminStatusOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.content.searchIndexItems, null);
  assert.equal(parsed.content.syncMeta, null);
  assert.equal(parsed.notion.adminPage, null);
  assert.equal(parsed.notion.rootPage?.title, "Home");
  assert.equal(parsed.env.hasDeployTarget, true);
  assert.equal(parsed.source.pendingDeployReason, "ACTIVE_DEPLOYMENT_SOURCE_SHA_UNAVAILABLE");
  assert.equal(parsed.source.deployableVersionReady, null);
  assert.equal(parsed.source.deployableVersionReason, "LATEST_WORKER_VERSION_UNAVAILABLE");
});

test("site-admin-status-contract: rejects malformed deployableVersionReady", () => {
  const parsed = parseSiteAdminStatusResult(
    makeValidPayload({
      source: {
        ...makeValidPayload().source,
        deployableVersionReady: "yes",
      },
    }),
  );
  assert.equal(parsed, null);
});
