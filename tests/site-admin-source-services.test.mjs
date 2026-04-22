import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildSiteAdminDeployPreviewPayload } from "../lib/server/site-admin-deploy-preview-service.ts";
import { buildSiteAdminStatusPayload } from "../lib/server/site-admin-status-service.ts";

function withMockFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
    delete globalThis.__siteAdminGithubTokenCache;
  });
}

function withEnv(t, patch) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function createGitHubFetchStub(initialFiles, options = {}) {
  const files = new Map(
    Object.entries(initialFiles).map(([filePath, text], index) => [
      filePath,
      { text, sha: `sha-${index + 1}` },
    ]),
  );
  const branchHeadSha = options.branchHeadSha || "source-head-sha";
  const commitDate = options.commitDate || "2026-04-21T12:00:00.000Z";

  return async (url, init = {}) => {
    const href = String(url);
    const method = String(init.method || "GET").toUpperCase();

    if (href === "https://api.github.com/app/installations/7/access_tokens" && method === "POST") {
      return Response.json({
        token: "installation-token",
        expires_at: "2099-01-01T00:00:00.000Z",
      });
    }

    if (href === "https://api.github.com/repos/acme/site/branches/main" && method === "GET") {
      return Response.json({ commit: { sha: branchHeadSha } });
    }

    if (href === `https://api.github.com/repos/acme/site/commits/${branchHeadSha}` && method === "GET") {
      return Response.json({ commit: { committer: { date: commitDate } } });
    }

    if (href.startsWith("https://api.github.com/repos/acme/site/contents/") && method === "GET") {
      const filePath = decodeURIComponent(
        href
          .replace("https://api.github.com/repos/acme/site/contents/", "")
          .replace(/\?ref=.*/, ""),
      );
      const hit = files.get(filePath);
      if (!hit) return Response.json({ message: "Not Found" }, { status: 404 });
      return Response.json({
        type: "file",
        sha: hit.sha,
        encoding: "base64",
        content: Buffer.from(hit.text, "utf8").toString("base64"),
      });
    }

    throw new Error(`Unexpected GitHub fetch: ${method} ${href}`);
  };
}

function loadFixture(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function githubEnv() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    CONTENT_SOURCE: "filesystem",
    SITE_ADMIN_STORAGE: "github",
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    GITHUB_APP_INSTALLATION_ID: "7",
    SITE_ADMIN_REPO_OWNER: "acme",
    SITE_ADMIN_REPO_NAME: "site",
    SITE_ADMIN_REPO_BRANCH: "main",
    NOTION_TOKEN: "",
    NOTION_SITE_ADMIN_PAGE_ID: "",
  };
}

test("site-admin source services: status payload reports github source head and pending deploy", async (t) => {
  const siteConfigText = loadFixture("content/filesystem/site-config.json");
  const protectedRoutesText = loadFixture("content/filesystem/protected-routes.json");
  const routesManifestText = loadFixture("content/filesystem/routes-manifest.json");
  withMockFetch(
    t,
    createGitHubFetchStub({
      "content/filesystem/site-config.json": siteConfigText,
      "content/filesystem/protected-routes.json": protectedRoutesText,
      "content/filesystem/routes-manifest.json": routesManifestText,
    }),
  );
  withEnv(t, {
    ...githubEnv(),
    VERCEL_GIT_COMMIT_SHA: "deployed-head-sha",
  });

  const payload = await buildSiteAdminStatusPayload();

  assert.equal(payload.source.storeKind, "github");
  assert.equal(payload.source.repo, "acme/site");
  assert.equal(payload.source.branch, "main");
  assert.equal(payload.source.headSha, "source-head-sha");
  assert.equal(payload.source.pendingDeploy, true);
  assert.equal(payload.source.error, undefined);
});

test("site-admin source services: deploy preview reads github source snapshot instead of local files", async (t) => {
  const siteConfigText = loadFixture("content/filesystem/site-config.json");
  const routesManifestText = loadFixture("content/filesystem/routes-manifest.json");
  const routesManifest = JSON.parse(routesManifestText);
  const extraProtectedRoutesText = `${JSON.stringify([
    {
      id: "test-protected",
      pageId: routesManifest[0].id,
      key: "pageId",
      path: routesManifest[0].routePath,
      mode: "prefix",
      auth: "github",
      token: "github-token",
    },
  ], null, 2)}\n`;

  withMockFetch(
    t,
    createGitHubFetchStub({
      "content/filesystem/site-config.json": siteConfigText,
      "content/filesystem/protected-routes.json": extraProtectedRoutesText,
      "content/filesystem/routes-manifest.json": routesManifestText,
    }),
  );
  withEnv(t, githubEnv());

  const payload = await buildSiteAdminDeployPreviewPayload();

  assert.equal(payload.hasChanges, true);
  assert.equal(payload.summary.protectedAdded >= 1, true);
  assert.equal(payload.samples.protected[0]?.path, routesManifest[0].routePath);
});
