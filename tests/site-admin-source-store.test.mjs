import assert from "node:assert/strict";
import crypto, { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGitHubAppJwt,
  createGitHubSiteAdminSourceStore,
  createLocalSiteAdminSourceStore,
} from "../lib/server/site-admin-source-store.ts";

function withMockFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
    delete globalThis.__siteAdminGithubTokenCache;
  });
}

async function withTempRoot(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-admin-source-store-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeSiteConfig() {
  return {
    siteName: "Example",
    lang: "en",
    seo: {
      title: "Example",
      description: "Example site",
      favicon: "/favicon.ico",
    },
    nav: {
      top: [{ label: "Home", href: "/" }],
      more: [],
    },
    content: {
      rootPageId: null,
      homePageId: null,
      routeOverrides: {},
    },
  };
}

function createGitHubFetchStub(initialFiles) {
  const files = new Map(
    Object.entries(initialFiles).map(([filePath, text], index) => [
      filePath,
      { text, sha: `sha-${index + 1}` },
    ]),
  );
  let branchHeadSha = "branch-head-initial";
  let commitDate = "2026-04-21T12:00:00.000Z";
  let putCount = 0;

  const fetchImpl = async (url, init = {}) => {
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

    if (href.startsWith("https://api.github.com/repos/acme/site/contents/") && method === "PUT") {
      const filePath = decodeURIComponent(
        href.replace("https://api.github.com/repos/acme/site/contents/", ""),
      );
      const body = JSON.parse(String(init.body || "{}"));
      const text = Buffer.from(String(body.content || ""), "base64").toString("utf8");
      putCount += 1;
      branchHeadSha = `branch-head-${putCount}`;
      commitDate = `2026-04-21T12:00:0${putCount}.000Z`;
      files.set(filePath, { text, sha: `sha-write-${putCount}` });
      return Response.json({ commit: { sha: branchHeadSha } }, { status: 200 });
    }

    throw new Error(`Unexpected GitHub fetch: ${method} ${href}`);
  };

  return {
    fetchImpl,
    getFile(filePath) {
      return files.get(filePath);
    },
    getPutCount() {
      return putCount;
    },
  };
}

test("site-admin-source-store: local store normalizes config and rejects stale writes", async (t) => {
  const rootDir = await withTempRoot(t);
  const sourceDir = path.join(rootDir, "content", "filesystem");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(
    path.join(sourceDir, "site-config.json"),
    JSON.stringify(makeSiteConfig(), null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(sourceDir, "protected-routes.json"), "[]\n", "utf8");
  await fs.writeFile(path.join(sourceDir, "routes-manifest.json"), "[]\n", "utf8");

  const store = createLocalSiteAdminSourceStore({ rootDir });
  const first = await store.getSnapshot();

  assert.equal(first.siteConfig.siteName, "Example");
  assert.equal(first.siteConfig.nav.top.length, 1);
  assert.match(first.siteConfig.nav.top[0].id, /^fs-nav-/);
  assert.match(first.version.siteConfigSha, /^local-/);
  assert.match(first.version.branchSha, /^local-branch-/);

  const second = await store.writeSiteConfig({
    expectedSiteConfigSha: first.version.siteConfigSha,
    nextSiteConfig: {
      ...first.siteConfig,
      siteName: "Updated Example",
    },
    commitMessage: "site-admin: update site settings",
  });

  assert.equal(second.siteConfig.siteName, "Updated Example");
  assert.notEqual(second.version.siteConfigSha, first.version.siteConfigSha);

  await assert.rejects(
    () =>
      store.writeSiteConfig({
        expectedSiteConfigSha: first.version.siteConfigSha,
        nextSiteConfig: second.siteConfig,
        commitMessage: "site-admin: update site settings",
      }),
    /Source changed/i,
  );
});

test("site-admin-source-store: createGitHubAppJwt returns a signed three-part token", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const jwt = createGitHubAppJwt({
    appId: "12345",
    privateKey: pem,
    nowSec: 1_700_000_000,
  });

  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  assert.ok(parts.every(Boolean));
});

test("site-admin-source-store: github store reads contents and writes minimal file updates", async (t) => {
  const siteConfigText = `${JSON.stringify(makeSiteConfig(), null, 2)}\n`;
  const protectedRoutesText = "[]\n";
  const routesManifestText = "[]\n";
  const stub = createGitHubFetchStub({
    "content/filesystem/site-config.json": siteConfigText,
    "content/filesystem/protected-routes.json": protectedRoutesText,
    "content/filesystem/routes-manifest.json": routesManifestText,
  });
  withMockFetch(t, stub.fetchImpl);

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const env = {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: pem,
    GITHUB_APP_INSTALLATION_ID: "7",
    SITE_ADMIN_REPO_OWNER: "acme",
    SITE_ADMIN_REPO_NAME: "site",
    SITE_ADMIN_REPO_BRANCH: "main",
  };

  const store = createGitHubSiteAdminSourceStore(env);
  const first = await store.getSnapshot();

  assert.equal(first.source.storeKind, "github");
  assert.equal(first.source.repo, "acme/site");
  assert.equal(first.source.branch, "main");
  assert.equal(first.siteConfig.siteName, "Example");

  const second = await store.writeSiteConfig({
    expectedSiteConfigSha: first.version.siteConfigSha,
    nextSiteConfig: {
      ...first.siteConfig,
      siteName: "Remote Example",
    },
    commitMessage: "site-admin: update site settings",
  });

  assert.equal(second.siteConfig.siteName, "Remote Example");
  assert.equal(stub.getPutCount(), 1);
  assert.match(stub.getFile("content/filesystem/site-config.json").text, /Remote Example/);

  await assert.rejects(
    () =>
      store.writeSiteConfig({
        expectedSiteConfigSha: first.version.siteConfigSha,
        nextSiteConfig: second.siteConfig,
        commitMessage: "site-admin: update site settings",
      }),
    /Source changed/i,
  );
});
