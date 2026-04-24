import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createGithubSiteAdminSourceStore,
  createGithubSiteAdminSourceStoreFromEnv,
  isSiteAdminSourceConflictError,
} from "../lib/server/site-admin-source-store.ts";

const OWNER = "acme";
const REPO = "site";
const BRANCH = "main";
const INSTALLATION_ID = "42";
const INSTALLATION_TOKEN = "inst-token-123";

function encodeBase64Json(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function makeGithubFileResponse(path, sha, parsed) {
  return {
    type: "file",
    path,
    sha,
    encoding: "base64",
    content: encodeBase64Json(parsed),
  };
}

function makeResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function decodeJwtPayload(token) {
  const [, payload] = String(token || "").split(".");
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function createPrivateKeyPem() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return privateKey.export({ format: "pem", type: "pkcs1" }).toString("utf8");
}

function createGithubFetchMock(input) {
  const calls = [];
  const config = {
    filesystemFiles: input.filesystemFiles || {},
    generatedFiles: input.generatedFiles || {},
    branchSha: input.branchSha || "branch-sha",
    branchDate: input.branchDate || "2026-04-22T00:00:00.000Z",
    tokenExpiresAt:
      input.tokenExpiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    putBehavior: input.putBehavior || "success",
    putResultSha: input.putResultSha || "new-site-config-sha",
    putCommitSha: input.putCommitSha || "new-commit-sha",
  };

  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ url: u.toString(), init });
    const authHeader = String(
      init?.headers?.Authorization ||
        init?.headers?.authorization ||
        "",
    );

    if (u.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
      const jwt = authHeader.replace(/^Bearer\s+/i, "");
      const payload = decodeJwtPayload(jwt);
      assert.ok(jwt.split(".").length === 3, "GitHub App JWT should have 3 segments");
      assert.equal(String(payload.iss), "1001");
      return makeResponse(201, {
        token: INSTALLATION_TOKEN,
        expires_at: config.tokenExpiresAt,
      });
    }

    // All repo API calls should use installation token.
    assert.equal(authHeader, `Bearer ${INSTALLATION_TOKEN}`);

    if (u.pathname === `/repos/${OWNER}/${REPO}/branches/${BRANCH}`) {
      return makeResponse(200, {
        name: BRANCH,
        commit: {
          sha: config.branchSha,
          commit: {
            committer: { date: config.branchDate },
          },
        },
      });
    }

    if (u.pathname.startsWith(`/repos/${OWNER}/${REPO}/contents/`)) {
      const relPath = decodeURIComponent(
        u.pathname.replace(`/repos/${OWNER}/${REPO}/contents/`, ""),
      );

      if (init.method === "PUT") {
        if (config.putBehavior === "conflict") {
          return makeResponse(409, { message: "sha does not match" });
        }
        return makeResponse(200, {
          content: {
            sha: config.putResultSha,
          },
          commit: {
            sha: config.putCommitSha,
          },
        });
      }

      const fsFile = config.filesystemFiles[relPath];
      if (fsFile) {
        return makeResponse(200, makeGithubFileResponse(relPath, fsFile.sha, fsFile.parsed));
      }

      const generatedFile = config.generatedFiles[relPath];
      if (generatedFile) {
        return makeResponse(200, makeGithubFileResponse(relPath, generatedFile.sha, generatedFile.parsed));
      }

      return makeResponse(404, { message: "Not Found" });
    }

    return makeResponse(404, { message: `Unhandled URL: ${u.toString()}` });
  };

  return { fetchMock, calls };
}

function withFetchMock(mock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test("site-admin-source-store github: loads config via generated fallback and branch head", async () => {
  const { fetchMock, calls } = createGithubFetchMock({
    filesystemFiles: {},
    generatedFiles: {
      "content/generated/site-config.json": {
        sha: "generated-site-config-sha",
        parsed: {
          siteName: "From GitHub",
          lang: "en",
          seo: { title: "From GitHub", description: "desc", favicon: "/favicon.ico" },
          nav: { top: [{ href: "/", label: "Home" }], more: [] },
        },
      },
      "content/generated/protected-routes.json": {
        sha: "generated-protected-sha",
        parsed: [],
      },
      "content/generated/routes-manifest.json": {
        sha: "generated-manifest-sha",
        parsed: [],
      },
    },
    branchSha: "branch-sha-abc",
    branchDate: "2026-04-22T00:00:00.000Z",
  });

  const store = createGithubSiteAdminSourceStore({
    appId: "1001",
    privateKey: createPrivateKeyPem(),
    installationId: INSTALLATION_ID,
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
  });

  await withFetchMock(fetchMock, async () => {
    const config = await store.loadConfig();
    const sourceState = await store.getSourceState();

    assert.equal(config.settings.siteName, "From GitHub");
    assert.equal(config.sourceVersion.siteConfigSha, "generated-site-config-sha");
    assert.equal(config.sourceVersion.branchSha, "branch-sha-abc");
    assert.equal(sourceState.storeKind, "github");
    assert.equal(sourceState.repo, `${OWNER}/${REPO}`);
    assert.equal(sourceState.branch, BRANCH);
    assert.equal(sourceState.headSha, "branch-sha-abc");
  });

  const tokenCalls = calls.filter((it) =>
    it.url.endsWith(`/app/installations/${INSTALLATION_ID}/access_tokens`),
  );
  assert.equal(tokenCalls.length, 1, "installation token should be cached per store");
});

test("site-admin-source-store github: updateSettings writes minimal file and returns new sourceVersion", async () => {
  const { fetchMock } = createGithubFetchMock({
    filesystemFiles: {
      "content/filesystem/site-config.json": {
        sha: "fs-site-config-sha",
        parsed: {
          siteName: "Before",
          lang: "en",
          seo: { title: "Before", description: "desc", favicon: "/favicon.ico" },
          nav: { top: [{ href: "/", label: "Home" }], more: [] },
        },
      },
      "content/filesystem/protected-routes.json": {
        sha: "fs-protected-sha",
        parsed: [],
      },
      "content/filesystem/routes-manifest.json": {
        sha: "fs-manifest-sha",
        parsed: [],
      },
    },
    branchSha: "branch-before-sha",
    putBehavior: "success",
    putResultSha: "fs-site-config-sha-new",
    putCommitSha: "branch-after-sha",
  });

  const store = createGithubSiteAdminSourceStore({
    appId: "1001",
    privateKey: createPrivateKeyPem(),
    installationId: INSTALLATION_ID,
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
  });

  await withFetchMock(fetchMock, async () => {
    const before = await store.loadConfig();
    const after = await store.updateSettings({
      rowId: before.settings.rowId,
      patch: { siteName: "After" },
      expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
    });
    assert.equal(after.siteConfigSha, "fs-site-config-sha-new");
    assert.equal(after.branchSha, "branch-after-sha");
  });
});

test("site-admin-source-store github: write conflict maps to SOURCE_CONFLICT", async () => {
  const { fetchMock } = createGithubFetchMock({
    filesystemFiles: {
      "content/filesystem/site-config.json": {
        sha: "fs-site-config-sha",
        parsed: {
          siteName: "Before",
          lang: "en",
          seo: { title: "Before", description: "desc", favicon: "/favicon.ico" },
          nav: { top: [{ href: "/", label: "Home" }], more: [] },
        },
      },
      "content/filesystem/protected-routes.json": {
        sha: "fs-protected-sha",
        parsed: [],
      },
      "content/filesystem/routes-manifest.json": {
        sha: "fs-manifest-sha",
        parsed: [],
      },
    },
    putBehavior: "conflict",
  });

  const store = createGithubSiteAdminSourceStore({
    appId: "1001",
    privateKey: createPrivateKeyPem(),
    installationId: INSTALLATION_ID,
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
  });

  await withFetchMock(fetchMock, async () => {
    const before = await store.loadConfig();
    await assert.rejects(
      () =>
        store.updateSettings({
          rowId: before.settings.rowId,
          patch: { siteName: "After" },
          expectedSiteConfigSha: before.sourceVersion.siteConfigSha,
        }),
      (err) => {
        assert.equal(isSiteAdminSourceConflictError(err), true);
        if (isSiteAdminSourceConflictError(err)) {
          assert.equal(err.code, "SOURCE_CONFLICT");
          assert.equal(err.expectedSha, before.sourceVersion.siteConfigSha);
          assert.equal(err.currentSha, "fs-site-config-sha");
        }
        return true;
      },
    );
  });
});

test("site-admin-source-store github: create from env supports GITHUB_APP_PRIVATE_KEY_FILE", async () => {
  const { fetchMock } = createGithubFetchMock({
    filesystemFiles: {
      "content/filesystem/site-config.json": {
        sha: "fs-site-config-sha",
        parsed: {
          siteName: "From Env Key File",
          lang: "en",
          seo: { title: "From Env Key File", description: "desc", favicon: "/favicon.ico" },
          nav: { top: [{ href: "/", label: "Home" }], more: [] },
        },
      },
      "content/filesystem/protected-routes.json": {
        sha: "fs-protected-sha",
        parsed: [],
      },
      "content/filesystem/routes-manifest.json": {
        sha: "fs-manifest-sha",
        parsed: [],
      },
    },
    branchSha: "branch-env-sha",
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-admin-private-key-"));
  const privateKeyPath = path.join(tempDir, "github-app.pem");
  fs.writeFileSync(privateKeyPath, createPrivateKeyPem(), "utf8");

  const keys = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_PRIVATE_KEY_FILE",
    "GITHUB_APP_INSTALLATION_ID",
    "SITE_ADMIN_REPO_OWNER",
    "SITE_ADMIN_REPO_NAME",
    "SITE_ADMIN_REPO_BRANCH",
  ];
  const prev = new Map(keys.map((k) => [k, process.env[k]]));
  process.env.GITHUB_APP_ID = "1001";
  process.env.GITHUB_APP_PRIVATE_KEY = "";
  process.env.GITHUB_APP_PRIVATE_KEY_FILE = privateKeyPath;
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.SITE_ADMIN_REPO_OWNER = OWNER;
  process.env.SITE_ADMIN_REPO_NAME = REPO;
  process.env.SITE_ADMIN_REPO_BRANCH = BRANCH;

  try {
    const store = createGithubSiteAdminSourceStoreFromEnv();
    await withFetchMock(fetchMock, async () => {
      const state = await store.getSourceState();
      assert.equal(state.storeKind, "github");
      assert.equal(state.repo, `${OWNER}/${REPO}`);
      assert.equal(state.branch, BRANCH);
      assert.equal(state.headSha, "branch-env-sha");
    });
  } finally {
    for (const k of keys) {
      const old = prev.get(k);
      if (old === undefined) delete process.env[k];
      else process.env[k] = old;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
