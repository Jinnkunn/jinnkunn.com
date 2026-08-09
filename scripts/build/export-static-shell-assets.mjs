#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pickStaticProtectedRule } from "../../cloudflare/static-shell-protection.mjs";

const cwd = process.cwd();
const appHtmlRoot = path.join(cwd, ".next", "server", "app");
const assetsRoot = path.join(cwd, ".open-next", "assets");
const outRoot = path.join(assetsRoot, "__static");
const manifestPath = path.join(outRoot, "routes.json");
const protectedPolicyPath = path.join(outRoot, "protected-routes-policy.json");
const headersPath = path.join(assetsRoot, "_headers");

// Cloudflare Workers Assets serves `/_next/static/*` itself, so the
// `headers()` block in next.config.mjs never runs for those requests — they
// came back `max-age=0, must-revalidate` in production despite being
// content-hashed and immutable. `_headers` is the only mechanism the asset
// server honours, so emit it at build time.
const ASSET_HEADERS = `/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff

/assets/*
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400
  X-Content-Type-Options: nosniff

/fonts/*
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400
  X-Content-Type-Options: nosniff

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
`;

function walkHtmlFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith(".html")) continue;
      out.push(abs);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function routeFromRelHtml(relHtmlPath) {
  const rel = relHtmlPath.replace(/\\/g, "/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) {
    const base = rel.slice(0, -"/index.html".length);
    return `/${base}`;
  }
  if (!rel.endsWith(".html")) return "";
  return `/${rel.slice(0, -".html".length)}`;
}

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(relPath, fallback) {
  const abs = path.join(cwd, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return fallback;
  }
}

function compactId(value) {
  return String(value || "").replace(/-/g, "").trim().toLowerCase();
}

function buildParentByPageId(routesManifest) {
  const out = {};
  const items = Array.isArray(routesManifest) ? routesManifest : [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = compactId(item.id);
    if (!id) continue;
    out[id] = compactId(item.parentId);
  }
  return out;
}

// The published policy is world-readable through the Worker's own
// `env.ASSETS.fetch()` key space, so it must not carry `rule.token` — that is
// the stored password verifier and nothing on the static path consumes it
// (`isStaticProtectionSatisfied` recomputes an HMAC from `rule.id` + a
// server-only secret). Strip it before writing.
function stripRuleVerifiers(rules) {
  return rules.map((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return rule;
    const rest = { ...rule };
    delete rest.token;
    return rest;
  });
}

function buildProtectedPolicy() {
  const filesystemProtected = readJsonFile("content/filesystem/protected-routes.json", []);
  const generatedProtected = readJsonFile("content/generated/protected-routes.json", []);
  const rules = Array.isArray(filesystemProtected) && filesystemProtected.length > 0
    ? filesystemProtected
    : Array.isArray(generatedProtected)
      ? generatedProtected
      : [];
  const routesMap = readJsonFile("content/generated/routes.json", {});
  const routesManifest = readJsonFile("content/generated/routes-manifest.json", []);
  return {
    rules,
    routesMap: routesMap && typeof routesMap === "object" && !Array.isArray(routesMap)
      ? routesMap
      : {},
    parentByPageId: buildParentByPageId(routesManifest),
  };
}

export function publishableProtectedPolicy(policy) {
  return { ...policy, rules: stripRuleVerifiers(policy.rules) };
}

function main() {
  if (!fs.existsSync(appHtmlRoot)) {
    throw new Error(`Missing Next app html root: ${appHtmlRoot}`);
  }
  ensureCleanDir(outRoot);

  const policy = buildProtectedPolicy();
  const htmlFiles = walkHtmlFiles(appHtmlRoot);
  const routes = [];
  const skippedProtected = [];

  for (const src of htmlFiles) {
    const rel = path.relative(appHtmlRoot, src);
    if (!rel || rel.startsWith("_")) continue;
    const route = routeFromRelHtml(rel);
    if (!route) continue;

    // Defence in depth alongside `run_worker_first`: a protected route's
    // prerendered HTML must never exist as a deployable asset at all. Matching
    // uses the same resolver the Worker runs, so the two cannot drift.
    if (pickStaticProtectedRule(route, policy)) {
      skippedProtected.push(route);
      continue;
    }

    const dst = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    routes.push(route);
  }

  const uniqRoutes = [...new Set(routes)].sort((a, b) => a.localeCompare(b));
  const payload = {
    count: uniqRoutes.length,
    routes: uniqRoutes,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    protectedPolicyPath,
    `${JSON.stringify(publishableProtectedPolicy(policy), null, 2)}\n`,
    "utf8",
  );

  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.writeFileSync(headersPath, ASSET_HEADERS, "utf8");

  const uniqSkipped = [...new Set(skippedProtected)].sort((a, b) => a.localeCompare(b));
  console.log(
    JSON.stringify(
      {
        ok: true,
        copiedHtml: uniqRoutes.length,
        skippedProtected: uniqSkipped,
        outDir: path.relative(cwd, outRoot),
        manifest: path.relative(cwd, manifestPath),
        protectedPolicy: path.relative(cwd, protectedPolicyPath),
        headers: path.relative(cwd, headersPath),
      },
      null,
      2,
    ),
  );
}

// Only run when invoked directly, so tests can import the pure helpers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
