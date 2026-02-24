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
      isVercel: true,
      vercelRegion: "iad1",
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
      commitSha: "abc",
      commitShort: "abc1234",
      branch: "main",
      commitMessage: "msg",
      deploymentId: "dep",
      vercelUrl: "example.vercel.app",
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
    freshness: {
      stale: false,
      syncMs: 100,
      notionEditedMs: 99,
      generatedLatestMs: 101,
    },
    ...overrides,
  };
}

test("site-admin-status-contract: parses valid success payload", () => {
  const parsed = parseSiteAdminStatusResult(makeValidPayload());
  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminStatusOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.env.isVercel, true);
  assert.equal(parsed.content.nav.top, 4);
  assert.equal(parsed.files.notionSyncCache.count, 12);
});

test("site-admin-status-contract: preserves api error payload", () => {
  const parsed = parseSiteAdminStatusResult({ ok: false, error: "Unauthorized" });
  assert.deepEqual(parsed, { ok: false, error: "Unauthorized" });
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
    }),
  );
  assert.ok(parsed);
  if (!parsed || !isSiteAdminStatusOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.content.searchIndexItems, null);
  assert.equal(parsed.content.syncMeta, null);
  assert.equal(parsed.notion.adminPage, null);
  assert.equal(parsed.notion.rootPage?.title, "Home");
});
