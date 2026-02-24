import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const OUT_ROOT = path.join(process.cwd(), "output", "a11y");
const AXE_SCRIPT_PATH = require.resolve("axe-core/axe.min.js");
const TARGET_PATHS = ["/", "/blog", "/publications"];
const FAILING_IMPACTS = new Set(["serious", "critical"]);

function envFlag(name) {
  return TRUE_VALUES.has(String(process.env[name] || "").trim().toLowerCase());
}

function isoStampForPath(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
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
  const portRaw = Number.parseInt(String(process.env.A11Y_PORT || "3012"), 10);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 3012;
  const baseURL = `http://localhost:${port}`;

  const stamp = isoStampForPath();
  const outDir = path.join(OUT_ROOT, stamp);
  await mkdir(outDir, { recursive: true });

  let server = null;
  let browser = null;

  const report = {
    generatedAt: new Date().toISOString(),
    baseURL,
    skipBuild,
    pages: [],
    summary: {
      totalViolations: 0,
      totalSeriousOrCritical: 0,
      failingPages: 0,
    },
  };

  try {
    if (!skipBuild) ensureBuild();
    server = startServer(port);
    await waitForServer(`${baseURL}/`);
    browser = await launchBrowser();

    for (const pathname of TARGET_PATHS) {
      const page = await browser.newPage();
      const url = `${baseURL}${pathname}`;
      const result = await runPageA11y(page, url);

      const rawViolations = Array.isArray(result?.violations) ? result.violations : [];
      const violations = rawViolations.map((v) => compactViolation(v, pathname));
      const high = violations.filter((v) => FAILING_IMPACTS.has(v.impact));
      const failing = high.length > 0;

      report.pages.push({
        path: pathname,
        url,
        violations,
        seriousOrCritical: high.length,
      });

      report.summary.totalViolations += violations.length;
      report.summary.totalSeriousOrCritical += high.length;
      if (failing) {
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

    if (report.summary.totalSeriousOrCritical > 0) {
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
