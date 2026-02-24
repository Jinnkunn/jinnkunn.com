import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const OUT_ROOT = path.join(process.cwd(), "output", "a11y");
const AXE_SCRIPT_PATH = require.resolve("axe-core/axe.min.js");
const DEFAULT_PRIORITY_PATHS = ["/", "/blog", "/publications"];
const DEFAULT_MAX_PAGES = 12;
const FAILING_IMPACTS = new Set(["serious", "critical"]);

function envFlag(name) {
  return TRUE_VALUES.has(String(process.env[name] || "").trim().toLowerCase());
}

function isoStampForPath(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function normalizePathname(pathname) {
  const p = String(pathname || "").trim();
  if (!p) return "";
  if (p === "/") return "/";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function parsePathList(value) {
  return String(value || "")
    .split(/[\s,]+/g)
    .map((item) => normalizePathname(item))
    .filter(Boolean);
}

function parseLocTags(xmlText) {
  const out = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let match;
  while ((match = re.exec(xmlText))) {
    const raw = String(match[1] || "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

function pathFromLoc(loc, origin) {
  try {
    const u = new URL(loc, origin);
    if (u.origin !== origin) return null;
    return normalizePathname(u.pathname);
  } catch {
    return null;
  }
}

function sectionKey(pathname) {
  if (pathname === "/") return "root";
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg || "root";
}

function pickAuditPaths(discovered, maxPages, priorityPaths) {
  const seen = new Set();
  const picked = [];

  const add = (pathname) => {
    const normalized = normalizePathname(pathname);
    if (!normalized || seen.has(normalized)) return false;
    if (
      normalized.startsWith("/api") ||
      normalized.startsWith("/_next") ||
      normalized.endsWith(".xml") ||
      normalized.endsWith(".txt")
    ) {
      return false;
    }
    seen.add(normalized);
    picked.push(normalized);
    return true;
  };

  for (const p of priorityPaths) {
    if (picked.length >= maxPages) break;
    add(p);
  }

  const groups = new Map();
  for (const p of discovered) {
    const normalized = normalizePathname(p);
    if (!normalized || seen.has(normalized)) continue;
    const key = sectionKey(normalized);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(normalized);
  }

  const keys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    groups.get(key).sort((a, b) => a.localeCompare(b));
  }

  while (picked.length < maxPages) {
    let progressed = false;
    for (const key of keys) {
      if (picked.length >= maxPages) break;
      const list = groups.get(key);
      if (!list || list.length === 0) continue;
      const next = list.shift();
      if (!next) continue;
      progressed = add(next) || progressed;
    }
    if (!progressed) break;
  }

  return picked;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return await res.text();
}

async function discoverSitemapPaths(baseURL, priorityPaths, maxPages) {
  const fullSite = envFlag("A11Y_FULL_SITE");
  const origin = new URL(baseURL).origin;
  const indexXml = await fetchText(`${baseURL}/sitemap.xml`);
  const sectionLocs = parseLocTags(indexXml);
  if (sectionLocs.length === 0) {
    throw new Error("Sitemap index contains no <loc> entries.");
  }

  const discovered = new Set();
  for (const loc of sectionLocs) {
    const sectionPath = pathFromLoc(loc, origin);
    if (!sectionPath) continue;
    const sectionXml = await fetchText(`${origin}${sectionPath}`);
    for (const pageLoc of parseLocTags(sectionXml)) {
      const pagePath = pathFromLoc(pageLoc, origin);
      if (pagePath) discovered.add(pagePath);
    }
  }

  if (discovered.size === 0) {
    throw new Error("No routes discovered from sitemap sections.");
  }

  const discoveredList = Array.from(discovered.values()).sort((a, b) => a.localeCompare(b));
  const targetPaths = fullSite
    ? discoveredList
    : pickAuditPaths(discoveredList, maxPages, priorityPaths);
  if (targetPaths.length === 0) {
    throw new Error("A11y path selection is empty after sitemap discovery.");
  }

  return {
    fullSite,
    sectionDocs: sectionLocs,
    discoveredPaths: discoveredList,
    targetPaths,
  };
}

function ensureBuild() {
  const r = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error("Build failed; cannot run a11y checks.");
  }
}

function startServer(port) {
  return spawn("npm", ["run", "start", "--", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port) },
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      // ignore
    }
    await sleep(400);
  }
  throw new Error(`Server not ready: ${url}`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

function compactViolation(v, pathname) {
  const nodes = Array.isArray(v.nodes) ? v.nodes : [];
  const first = nodes[0];
  const selectors =
    first && Array.isArray(first.target) ? first.target.map((s) => String(s || "")).filter(Boolean) : [];

  return {
    page: pathname,
    id: String(v.id || ""),
    impact: String(v.impact || "unknown"),
    help: String(v.help || ""),
    helpUrl: String(v.helpUrl || ""),
    nodes: nodes.length,
    target: selectors.slice(0, 3),
  };
}

async function runPageA11y(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.addScriptTag({ path: AXE_SCRIPT_PATH });
  const out = await page.evaluate(async () => {
    return await globalThis.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa"],
      },
      resultTypes: ["violations"],
    });
  });
  return out;
}

async function main() {
  const skipBuild = envFlag("A11Y_SKIP_BUILD");
  const failAll = envFlag("A11Y_FAIL_ALL");
  const fullSiteMode = envFlag("A11Y_FULL_SITE");
  const failAllEffective = failAll || fullSiteMode;
  const portRaw = Number.parseInt(String(process.env.A11Y_PORT || "3012"), 10);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 3012;
  const baseURL = `http://localhost:${port}`;
  const maxPagesRaw = Number.parseInt(String(process.env.A11Y_MAX_PAGES || DEFAULT_MAX_PAGES), 10);
  const maxPages = Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? maxPagesRaw : DEFAULT_MAX_PAGES;
  const priorityPaths = parsePathList(process.env.A11Y_PRIORITY_PATHS || DEFAULT_PRIORITY_PATHS.join(","));
  const explicitPaths = parsePathList(process.env.A11Y_PATHS || "");

  const stamp = isoStampForPath();
  const outDir = path.join(OUT_ROOT, stamp);
  await mkdir(outDir, { recursive: true });

  let server = null;
  let browser = null;

  const report = {
    generatedAt: new Date().toISOString(),
    baseURL,
    skipBuild,
    fullSite: fullSiteMode,
    maxPages,
    priorityPaths,
    source: explicitPaths.length > 0 ? "env" : "sitemap",
    failMode: failAllEffective ? "all" : "core",
    discoveredCount: 0,
    discoveredPaths: [],
    targetPaths: [],
    pages: [],
    summary: {
      totalViolations: 0,
      totalSeriousOrCritical: 0,
      totalBlockingSeriousOrCritical: 0,
      failingPages: 0,
    },
  };

  try {
    if (!skipBuild) ensureBuild();
    server = startServer(port);
    await waitForServer(`${baseURL}/`);
    browser = await launchBrowser();

    let targetPaths = explicitPaths;
    if (targetPaths.length === 0) {
      const discovered = await discoverSitemapPaths(baseURL, priorityPaths, maxPages);
      report.fullSite = discovered.fullSite;
      report.discoveredCount = discovered.discoveredPaths.length;
      report.discoveredPaths = discovered.discoveredPaths;
      report.targetPaths = discovered.targetPaths;
      targetPaths = discovered.targetPaths;
    } else {
      report.targetPaths = targetPaths;
      report.discoveredCount = targetPaths.length;
      report.discoveredPaths = targetPaths;
    }

    console.log(
      `[a11y] Source=${report.source}; failMode=${report.failMode}; discovered=${report.discoveredCount}; auditing=${targetPaths.length}; max=${maxPages}`,
    );
    if (report.fullSite) {
      console.log("[a11y] full-site mode enabled (all sitemap routes are blocking).");
    }

    const enforcedPaths = new Set(priorityPaths.map((p) => normalizePathname(p)).filter(Boolean));

    for (const pathname of targetPaths) {
      const page = await browser.newPage();
      const url = `${baseURL}${pathname}`;
      const result = await runPageA11y(page, url);

      const rawViolations = Array.isArray(result?.violations) ? result.violations : [];
      const violations = rawViolations.map((v) => compactViolation(v, pathname));
      const high = violations.filter((v) => FAILING_IMPACTS.has(v.impact));
      const isEnforced = enforcedPaths.has(pathname);
      const blocking = failAllEffective ? high.length : isEnforced ? high.length : 0;

      report.pages.push({
        path: pathname,
        url,
        enforced: isEnforced,
        violations,
        seriousOrCritical: high.length,
        blockingSeriousOrCritical: blocking,
      });

      report.summary.totalViolations += violations.length;
      report.summary.totalSeriousOrCritical += high.length;
      report.summary.totalBlockingSeriousOrCritical += blocking;
      if (blocking > 0) {
        report.summary.failingPages += 1;
        await page.screenshot({
          path: path.join(outDir, `fail-${pathname === "/" ? "home" : pathname.slice(1)}.png`),
          fullPage: true,
        });
      }
      await page.close();
    }

    await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(path.join(OUT_ROOT, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(`Wrote ${path.relative(process.cwd(), outDir)}/report.json`);
    console.log(`Wrote ${path.relative(process.cwd(), OUT_ROOT)}/latest.json`);

    if (report.summary.totalBlockingSeriousOrCritical > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
