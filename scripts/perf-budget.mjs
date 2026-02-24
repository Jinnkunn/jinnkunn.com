import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const OUT_ROOT = path.join(process.cwd(), "output", "perf");
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function envFlag(name, defaultValue = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return TRUE_VALUES.has(raw);
}

function envNumber(name, defaultValue) {
  const n = Number.parseFloat(String(process.env[name] || ""));
  return Number.isFinite(n) ? n : defaultValue;
}

function parsePaths(value) {
  const raw = String(value || "")
    .split(/[\s,]+/g)
    .map((it) => String(it || "").trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const it of raw) {
    const p = it.startsWith("/") ? it : `/${it}`;
    const normalized = p === "/" ? "/" : p.replace(/\/+$/g, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isoStampForPath(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
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

function ensureBuild() {
  const r = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error("Build failed; cannot run performance budget checks.");
  }
}

function startServer(port) {
  return spawn("npm", ["run", "start", "--", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port) },
  });
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

function round(n, digits = 2) {
  const m = Math.pow(10, digits);
  return Math.round(Number(n || 0) * m) / m;
}

async function collectRouteVitals(page, baseURL, routePath) {
  await page.addInitScript(() => {
    const state = { lcp: 0, cls: 0, inp: 0 };
    globalThis.__perfVitals = state;

    try {
      const lcpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.lcp = Math.max(state.lcp || 0, entry.startTime || 0);
        }
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // unsupported
    }

    try {
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          state.cls += entry.value || 0;
        }
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
    } catch {
      // unsupported
    }

    try {
      const inpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.interactionId) continue;
          state.inp = Math.max(state.inp || 0, entry.duration || 0);
        }
      });
      inpObs.observe({ type: "event", durationThreshold: 16, buffered: true });
    } catch {
      // unsupported
    }
  });

  await page.goto(`${baseURL}${routePath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const vp = page.viewportSize() || { width: 1280, height: 800 };
  await page.mouse.click(Math.floor(vp.width * 0.5), Math.floor(vp.height * 0.45));
  await page.mouse.wheel(0, 450);
  await page.keyboard.press("Tab").catch(() => {});
  await page.waitForTimeout(600);

  const out = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const navObj = nav || {};
    const ttfb =
      typeof navObj.responseStart === "number" && navObj.responseStart >= 0
        ? navObj.responseStart
        : 0;
    const vitals = globalThis.__perfVitals || { lcp: 0, cls: 0, inp: 0 };
    return {
      lcp: Number(vitals.lcp || 0),
      cls: Number(vitals.cls || 0),
      inp: Number(vitals.inp || 0),
      ttfb: Number(ttfb || 0),
    };
  });

  return {
    lcp: round(out.lcp, 1),
    cls: round(out.cls, 4),
    inp: round(out.inp, 1),
    ttfb: round(out.ttfb, 1),
  };
}

async function main() {
  const skipBuild = envFlag("PERF_SKIP_BUILD");
  const strict = envFlag("PERF_STRICT", true);
  const portRaw = Number.parseInt(String(process.env.PERF_PORT || "3014"), 10);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 3014;
  const baseURL = `http://localhost:${port}`;

  const budget = {
    lcpMs: Math.max(1, envNumber("PERF_BUDGET_LCP_MS", 4500)),
    cls: Math.max(0.001, envNumber("PERF_BUDGET_CLS", 0.12)),
    inpMs: Math.max(1, envNumber("PERF_BUDGET_INP_MS", 300)),
  };

  const paths = parsePaths(process.env.PERF_PATHS || "/,/blog,/publications");
  if (!paths.length) throw new Error("No PERF_PATHS selected.");

  const stamp = isoStampForPath();
  const outDir = path.join(OUT_ROOT, stamp);
  await mkdir(outDir, { recursive: true });

  let server = null;
  let browser = null;

  const report = {
    generatedAt: new Date().toISOString(),
    baseURL,
    skipBuild,
    strict,
    budget,
    paths,
    pages: [],
    summary: {
      failingPages: 0,
      maxLcp: 0,
      maxCls: 0,
      maxInp: 0,
    },
  };

  try {
    if (!skipBuild) ensureBuild();
    server = startServer(port);
    await waitForServer(`${baseURL}/`);
    browser = await launchBrowser();

    for (const routePath of paths) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const metrics = await collectRouteVitals(page, baseURL, routePath);
      const checks = {
        lcp: metrics.lcp <= budget.lcpMs,
        cls: metrics.cls <= budget.cls,
        inp: metrics.inp <= budget.inpMs,
      };
      const pass = checks.lcp && checks.cls && checks.inp;
      if (!pass) {
        report.summary.failingPages += 1;
        await page.screenshot({
          path: path.join(outDir, `fail-${routePath === "/" ? "home" : routePath.slice(1)}.png`),
          fullPage: true,
        });
      }
      report.summary.maxLcp = Math.max(report.summary.maxLcp, metrics.lcp);
      report.summary.maxCls = Math.max(report.summary.maxCls, metrics.cls);
      report.summary.maxInp = Math.max(report.summary.maxInp, metrics.inp);
      report.pages.push({
        path: routePath,
        metrics,
        checks,
        pass,
      });
      await page.close();
    }

    await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(path.join(OUT_ROOT, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(`Wrote ${path.relative(process.cwd(), outDir)}/report.json`);
    console.log(`Wrote ${path.relative(process.cwd(), OUT_ROOT)}/latest.json`);
    console.log(
      `[perf] max: LCP=${report.summary.maxLcp}ms CLS=${report.summary.maxCls} INP=${report.summary.maxInp}ms`,
    );

    if (strict && report.summary.failingPages > 0) {
      throw new Error(`Performance budget failed on ${report.summary.failingPages} page(s).`);
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (server && !server.killed) {
      server.kill("SIGTERM");
      await sleep(200);
      if (!server.killed) server.kill("SIGKILL");
    }
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
