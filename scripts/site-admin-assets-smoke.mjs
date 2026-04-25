#!/usr/bin/env node

import { encode } from "next-auth/jwt";

import { asBool, asString, parseArgs } from "./_lib/cli.mjs";
import { loadProjectEnv } from "./load-project-env.mjs";

const DEFAULT_STAGING_ORIGIN = "https://staging.jinkunchen.com";
const DEFAULT_PRODUCTION_ORIGIN = "https://jinkunchen.com";
const CDN_ORIGIN = "https://cdn.jinkunchen.com";

function normalizeEnvName(value) {
  const raw = asString(value).toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  return "staging";
}

function normalizeOrigin(value) {
  return asString(value).replace(/\/+$/, "");
}

function firstGithubUserFromCsv(raw) {
  const users = String(raw || "")
    .split(/[,\n]/)
    .map((item) => item.trim().replace(/^@+/, "").toLowerCase())
    .filter(Boolean);
  return users[0] || "";
}

function unwrapApiData(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return "data" in raw ? raw.data : raw;
}

function assertCondition(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length
    ? `\n${JSON.stringify(details, null, 2)}`
    : "";
  throw new Error(`${message}${suffix}`);
}

async function buildAutoSiteAdminCookie() {
  const secret = asString(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "");
  const login = firstGithubUserFromCsv(process.env.SITE_ADMIN_GITHUB_USERS || "");
  if (!secret || !login) return "";
  const token = await encode({
    secret,
    token: {
      sub: `asset-smoke-${login}`,
      login,
      name: login,
    },
    maxAge: 60 * 30,
  });
  return `__Secure-next-auth.session-token=${token}; next-auth.session-token=${token}`;
}

async function requestJson({ method, url, cookie, body }) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function deleteUploadedAsset({ baseUrl, cookie, key, version }) {
  if (!key || !version) return { skipped: true };
  const deleteOut = await requestJson({
    method: "DELETE",
    url: `${baseUrl}/api/site-admin/assets`,
    cookie,
    body: { key, version },
  });
  return {
    skipped: false,
    ok: deleteOut.res.ok,
    status: deleteOut.res.status,
    body: deleteOut.text,
  };
}

function resolveBaseUrl(envName, argBaseUrl) {
  const explicit = normalizeOrigin(argBaseUrl);
  if (explicit) return explicit;
  if (envName === "production") {
    return normalizeOrigin(
      process.env.SITE_ADMIN_BASE_URL_PRODUCTION ||
        process.env.SITE_ADMIN_BASE_URL ||
        DEFAULT_PRODUCTION_ORIGIN,
    );
  }
  const stagingOrigin = normalizeOrigin(
    process.env.SITE_ADMIN_BASE_URL_STAGING ||
      process.env.SITE_ADMIN_STAGING_BASE_URL ||
      DEFAULT_STAGING_ORIGIN,
  );
  return stagingOrigin.includes(".workers.dev") ? DEFAULT_STAGING_ORIGIN : stagingOrigin;
}

function randomPngBytes() {
  return Buffer.from(`asset-smoke ${new Date().toISOString()} ${Math.random()}`, "utf8");
}

async function main() {
  loadProjectEnv({ override: false, files: [".env"] });

  const args = parseArgs(process.argv.slice(2));
  const envName = normalizeEnvName(args.env || process.env.SITE_ADMIN_ASSETS_SMOKE_ENV);
  const allowProduction = asBool(args["allow-production"], false);
  if (envName === "production" && !allowProduction) {
    throw new Error("production asset smoke requires --allow-production");
  }

  const baseUrl = resolveBaseUrl(envName, args.baseUrl);
  const cookie = asString(args.cookie || process.env.SITE_ADMIN_COOKIE || "") ||
    (await buildAutoSiteAdminCookie());
  assertCondition(Boolean(cookie), "missing site-admin cookie and auto-cookie generation failed");

  let url = "";
  let key = "";
  let version = "";
  let secondHead = null;
  try {
    const upload = await requestJson({
      method: "POST",
      url: `${baseUrl}/api/site-admin/assets`,
      cookie,
      body: {
        filename: "asset-smoke.png",
        contentType: "image/png",
        base64: randomPngBytes().toString("base64"),
      },
    });
    assertCondition(
      upload.res.status === 201 && upload.json?.ok === true,
      "asset upload failed",
      { status: upload.res.status, body: upload.text },
    );

    const asset = unwrapApiData(upload.json);
    url = asString(asset?.url || "");
    key = asString(asset?.key || "");
    version = asString(asset?.version || "");
    assertCondition(Boolean(version), "upload response missing version", { asset });
    assertCondition(url.startsWith(`${CDN_ORIGIN}/uploads/`), "upload returned non-CDN URL", {
      url,
      key,
    });
    assertCondition(key.startsWith("uploads/"), "upload returned non-R2 key", { key });

    const firstHead = await fetch(url, { method: "HEAD", cache: "no-store" });
    assertCondition(firstHead.ok, "CDN HEAD failed", { status: firstHead.status, url });
    secondHead = await fetch(url, { method: "HEAD", cache: "no-store" });
    assertCondition(secondHead.ok, "second CDN HEAD failed", {
      status: secondHead.status,
      url,
    });

    const cacheControl = secondHead.headers.get("cache-control") || "";
    assertCondition(
      cacheControl.includes("max-age=31536000") && cacheControl.includes("immutable"),
      "CDN response cache-control drifted",
      { cacheControl },
    );
  } finally {
    const deleteOut = await deleteUploadedAsset({ baseUrl, cookie, key, version });
    assertCondition(deleteOut.skipped || deleteOut.ok, "asset delete failed", {
      status: deleteOut.status,
      body: deleteOut.body,
      key,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        env: envName,
        baseUrl,
        uploadedUrl: url,
        key,
        cdn: {
          status: secondHead?.status || null,
          cacheControl: secondHead?.headers.get("cache-control") || "",
          cfCacheStatus: secondHead?.headers.get("cf-cache-status") || null,
        },
        deleted: true,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(`[site-admin-assets-smoke] FAIL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});
