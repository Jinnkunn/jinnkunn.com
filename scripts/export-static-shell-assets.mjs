#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const appHtmlRoot = path.join(cwd, ".next", "server", "app");
const outRoot = path.join(cwd, ".open-next", "assets", "__static");
const manifestPath = path.join(outRoot, "routes.json");

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

function main() {
  if (!fs.existsSync(appHtmlRoot)) {
    throw new Error(`Missing Next app html root: ${appHtmlRoot}`);
  }
  ensureCleanDir(outRoot);

  const htmlFiles = walkHtmlFiles(appHtmlRoot);
  const routes = [];

  for (const src of htmlFiles) {
    const rel = path.relative(appHtmlRoot, src);
    if (!rel || rel.startsWith("_")) continue;
    const route = routeFromRelHtml(rel);
    if (!route) continue;

    const dst = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    routes.push(route);
  }

  const uniqRoutes = [...new Set(routes)].sort((a, b) => a.localeCompare(b));
  const payload = {
    generatedAt: new Date().toISOString(),
    count: uniqRoutes.length,
    routes: uniqRoutes,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        copiedHtml: uniqRoutes.length,
        outDir: path.relative(cwd, outRoot),
        manifest: path.relative(cwd, manifestPath),
      },
      null,
      2,
    ),
  );
}

main();
