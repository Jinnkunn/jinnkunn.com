import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const OUT_ROOT = path.join(process.cwd(), "output", "ui-smoke");
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const BLOG_THEME_PROBE_PATH = "/blog";
const BLOG_STABLE_POST =
  "/blog/context-order-and-reasoning-drift-measuring-order-sensitivity-from-token-probabilities";
const EMBED_POST =
  "/blog/list/do-language-model-embeddings-form-an-approximate-abelian-group";
const REFERENCES_POST =
  "/blog/list/the-effect-of-chunk-retrieval-sequence-in-rag-on-multi-step-inference-performance-of-large-language-models";
const SCRIPT_NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || "codex-design-system-qa-secret";

function envFlag(name) {
  return TRUE_VALUES.has(String(process.env[name] || "").trim().toLowerCase());
}

function isoStampForPath(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function buildThemedUrl(baseURL, pathname, theme) {
  const url = new URL(pathname, baseURL);
  if (theme) url.searchParams.set("theme", theme);
  return url.toString();
}

async function captureFailure(page, outDir, name, fullPage = true) {
  await page.screenshot({
    path: path.join(outDir, `${name}.png`),
    fullPage,
  });
}

async function gotoPath(page, baseURL, pathname, options = {}) {
  const { theme = null, waitUntil = "networkidle" } = options;
  const url = buildThemedUrl(baseURL, pathname, theme);
  await page.goto(url, { waitUntil });
  if (theme) {
    await page.waitForFunction(
      (expectedTheme) => document.documentElement.dataset.theme === expectedTheme,
      theme,
    );
  }
  return url;
}

async function readTheme(page) {
  return await page.evaluate(() => document.documentElement.dataset.theme || "");
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
  // Keep this script self-contained: build if needed.
  const r = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error("Build failed; cannot run smoke tests.");
  }
}

function startServer(port) {
  const child = spawn("npm", ["run", "start", "--", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      NEXTAUTH_SECRET: SCRIPT_NEXTAUTH_SECRET,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || `http://127.0.0.1:${port}`,
    },
  });
  return child;
}

async function launchBrowser() {
  // Prefer system Chrome when available, but fall back for CI runners.
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function main() {
  const quick = envFlag("SMOKE_UI_QUICK");
  const skipBuild = envFlag("SMOKE_UI_SKIP_BUILD");
  const stamp = isoStampForPath();
  const outDir = path.join(OUT_ROOT, stamp);
  await mkdir(outDir, { recursive: true });

  const portRaw = Number.parseInt(String(process.env.SMOKE_UI_PORT || "3011"), 10);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 3011;
  const baseURL = `http://localhost:${port}`;

  const results = {
    generatedAt: new Date().toISOString(),
    baseURL,
    profile: quick ? "quick" : "full",
    skipBuild,
    checks: [],
  };

  const record = (name, ok, details = {}) => {
    results.checks.push({ name, ok, ...details });
  };

  let server = null;
  let browser = null;

  try {
    if (!skipBuild) ensureBuild();
    server = startServer(port);

    // Capture a small tail of server logs for debugging.
    let serverStdout = "";
    let serverStderr = "";
    server.stdout.on("data", (d) => {
      serverStdout += String(d);
      serverStdout = serverStdout.slice(-40_000);
    });
    server.stderr.on("data", (d) => {
      serverStderr += String(d);
      serverStderr = serverStderr.slice(-40_000);
    });

    await waitForServer(`${baseURL}/`);

    browser = await launchBrowser();

    // Desktop checks
    {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: "light",
      });
      const page = await context.newPage();
      await gotoPath(page, baseURL, "/");

      // Theme toggle + persistence
      try {
        const initialTheme = await readTheme(page);
        record("desktop:theme-default-light", initialTheme === "light", { initialTheme });

        await page.getByRole("button", { name: "Switch to dark theme" }).click();
        await page.waitForTimeout(140);

        const toggledTheme = await readTheme(page);
        const storedTheme = await page.evaluate(() => window.localStorage.getItem("ds-theme"));
        record("desktop:theme-toggle-dark", toggledTheme === "dark", { toggledTheme });
        record("desktop:theme-storage-persisted", storedTheme === "dark", { storedTheme });

        await page.reload({ waitUntil: "networkidle" });
        const reloadedTheme = await readTheme(page);
        record("desktop:theme-refresh-persists", reloadedTheme === "dark", { reloadedTheme });
      } catch (e) {
        record("desktop:theme-toggle", false, { error: String(e) });
        await captureFailure(page, outDir, "fail-desktop-theme");
      }

      // More hover shows dropdown
      try {
        await page.hover("#more-trigger");
        await page.waitForTimeout(200);
        const visible = await page.isVisible("#more-menu");
        const theme = await readTheme(page);
        record("desktop:more-hover-dropdown", visible && theme === "dark", { theme });
        if (!visible) {
          await captureFailure(page, outDir, "fail-desktop-more-hover");
        }
      } catch (e) {
        record("desktop:more-hover-dropdown", false, { error: String(e) });
      }

      // Search modal basics: open, scope pill, results, clear, close in dark mode.
      try {
        await gotoPath(page, baseURL, BLOG_THEME_PROBE_PATH);
        const theme = await readTheme(page);
        record("desktop:search-theme-dark", theme === "dark", { theme });

        await page.click("#search-trigger");
        await page.waitForSelector("#notion-search.open", { timeout: 4000 });

        const scopeVisible = await page.isVisible("#notion-search-scope:not(.is-hidden)");
        record("desktop:search-scope-pill-visible", scopeVisible);

        await page.fill("#notion-search-input", "drift");
        await page.waitForTimeout(250);
        const hasResults = (await page.locator(".notion-search__result-item").count()) > 0;
        record("desktop:search-has-results", hasResults);

        // Clear query should empty input + show empty state.
        await page.click("#notion-search-clear");
        await page.waitForTimeout(120);
        const cleared = (await page.inputValue("#notion-search-input")).trim() === "";
        record("desktop:search-clear-button", cleared);

        // Close modal.
        await page.click("#notion-search-close");
        await page.waitForTimeout(220);
        const closed = !(await page.isVisible("#notion-search.open"));
        record("desktop:search-close-button", closed);
      } catch (e) {
        record("desktop:search-modal", false, { error: String(e) });
        await captureFailure(page, outDir, "fail-desktop-search");
      }

      // Site Admin shell should still load with dark theme applied.
      try {
        await gotoPath(page, baseURL, "/site-admin");
        await page.waitForTimeout(220);
        const theme = await readTheme(page);
        const hasShell = (await page.locator("main, .page-state").count()) > 0;
        record("desktop:site-admin-theme-dark", theme === "dark", {
          theme,
          path: new URL(page.url()).pathname,
        });
        record("desktop:site-admin-shell-available", hasShell, {
          path: new URL(page.url()).pathname,
        });
        if (!hasShell) {
          await captureFailure(page, outDir, "fail-desktop-site-admin");
        }
      } catch (e) {
        record("desktop:site-admin-dark", false, { error: String(e) });
        await captureFailure(page, outDir, "fail-desktop-site-admin");
      }

      await context.close();
    }

    // Mobile checks
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        colorScheme: "light",
      });
      await context.addInitScript(() => {
        window.localStorage.setItem("ds-theme", "dark");
      });
      const page = await context.newPage();
      await gotoPath(page, baseURL, "/");

      try {
        const theme = await readTheme(page);
        record("mobile:theme-from-storage-dark", theme === "dark", { theme });
      } catch (e) {
        record("mobile:theme-from-storage-dark", false, { error: String(e) });
      }

      // Open menu
      try {
        await page.click("#mobile-trigger");
        const open = await page.isVisible("#mobile-menu");
        const theme = await readTheme(page);
        record("mobile:menu-open", open && theme === "dark", { theme });
        if (!open) {
          await captureFailure(page, outDir, "fail-mobile-menu-open");
        }
      } catch (e) {
        record("mobile:menu-open", false, { error: String(e) });
      }

      // Close menu
      try {
        // Close via explicit close button (more reliable than keyboard on mobile contexts).
        await page.waitForTimeout(220);
        try {
          await page.waitForSelector("#mobile-close", {
            state: "visible",
            timeout: 2500,
          });
          await page.click("#mobile-close");
        } catch {
          // Backdrop is always present once the dialog opens.
          await page.click("#mobile-backdrop");
        }

        await page.waitForTimeout(900);
        const visible = await page.isVisible("#mobile-menu");
        const hidden = await page.locator("#mobile-menu").evaluate((el) => el.hidden);
        const closed = !visible && hidden;
        record("mobile:menu-close-button", closed, { visible, hidden });
      } catch (e) {
        record("mobile:menu-close-button", false, { error: String(e) });
      }

      await context.close();
    }

    // Notion behaviors on a content page that includes toggles + code blocks.
    {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
      });
      const page = await context.newPage();
      // Pick a stable blog post that includes toggles + code blocks.
      await gotoPath(page, baseURL, BLOG_STABLE_POST);

      // Toggle expand/collapse (if present)
      try {
        // Prefer a toggle that actually contains a code copy button in its content.
        const preferred = page.locator(
          ".notion-toggle:has(.notion-code__copy-button) .notion-toggle__summary"
        );
        const summary =
          (await preferred.count()) > 0
            ? preferred.first()
            : page.locator(".notion-toggle .notion-toggle__summary").first();
        const hasToggle = (await summary.count()) > 0;
        if (!hasToggle) {
          record("notion:toggle-present", false);
        } else {
          record("notion:toggle-present", true);
          const before = await summary.getAttribute("aria-expanded");
          await summary.scrollIntoViewIfNeeded();
          await summary.click();
          await page.waitForTimeout(150);
          const after = await summary.getAttribute("aria-expanded");
          record("notion:toggle-click-toggles", before !== after, {
            before,
            after,
          });
        }
      } catch (e) {
        record("notion:toggle", false, { error: String(e) });
      }

      // Code copy (if present)
      try {
        const copyBtn = page.locator(".notion-code__copy-button").first();
        const hasCopy = (await copyBtn.count()) > 0;
        if (!hasCopy) {
          record("notion:code-copy-button-present", false);
        } else {
          record("notion:code-copy-button-present", true);
          await copyBtn.scrollIntoViewIfNeeded();
          await copyBtn.click();
          await page.waitForTimeout(80);
          const txt = await copyBtn.textContent();
          record("notion:code-copy-feedback", /copied/i.test(txt || ""), {
            buttonText: txt || "",
          });
        }
      } catch (e) {
        record("notion:code-copy", false, { error: String(e) });
      }

      // Image lightbox (if present)
      try {
        const img = page.locator(".notion-image img").first();
        const hasImg = (await img.count()) > 0;
        if (!hasImg) {
          record("notion:image-present", false);
        } else {
          record("notion:image-present", true);
          await img.scrollIntoViewIfNeeded();
          await img.click();
          const open = await page.isVisible('#notion-lightbox[data-open="true"]');
          record("notion:image-lightbox-open", open);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(80);
          const closed = !(await page.isVisible('#notion-lightbox[data-open="true"]'));
          record("notion:image-lightbox-close", closed);
        }
      } catch (e) {
        record("notion:image-lightbox", false, { error: String(e) });
      }

      await context.close();
    }

    // Embed loader hides (separate page that includes embeds).
    // Skip in quick profile: this is slower and network-dependent.
    if (!quick) {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
      });
      const page = await context.newPage();
      await gotoPath(page, baseURL, EMBED_POST);

      try {
        const embed = page.locator(".notion-embed").first();
        const hasEmbed = (await embed.count()) > 0;
        if (!hasEmbed) {
          record("notion:embed-present", false);
        } else {
          record("notion:embed-present", true);
          await embed.scrollIntoViewIfNeeded();
          await page.waitForTimeout(7000);
          const loader = embed.locator(".notion-embed__loader");
          const loaderCount = await loader.count();
          if (loaderCount === 0) {
            record("notion:embed-loader-exists", false);
          } else {
            record("notion:embed-loader-exists", true);
            const display = await loader.evaluate((el) => getComputedStyle(el).display);
            record("notion:embed-loader-hidden", display === "none", { display });
            if (display !== "none") {
              await page.screenshot({
                path: path.join(outDir, "fail-embed-loader.png"),
                fullPage: true,
              });
            }
          }
        }
      } catch (e) {
        record("notion:embed-loader", false, { error: String(e) });
      }

      await context.close();
    }

    // References typography (ensure it's not oversized).
    // Skip in quick profile to keep PR gate fast/stable.
    if (!quick) {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
      });
      const page = await context.newPage();
      await gotoPath(page, baseURL, REFERENCES_POST);

      try {
        const refsToggle = page.locator(".notion-toggle-heading-1", {
          hasText: "References",
        });
        const hasRefs = (await refsToggle.count()) > 0;
        if (!hasRefs) {
          record("notion:references-toggle-present", false);
        } else {
          record("notion:references-toggle-present", true);
          const summary = refsToggle.locator(".notion-toggle__summary").first();
          await summary.scrollIntoViewIfNeeded();
          await summary.click();
          await page.waitForTimeout(250);

          const kind = await refsToggle.first().getAttribute("data-toggle-kind");
          record("notion:references-toggle-kind", kind === "references", { kind });

          const content = refsToggle.locator(".notion-toggle__content").first();
          const fontSize = await content.evaluate((el) =>
            parseFloat(getComputedStyle(el).fontSize || "0"),
          );
          record("notion:references-font-size", fontSize > 0 && fontSize <= 15, {
            fontSize,
          });
        }
      } catch (e) {
        record("notion:references-typography", false, { error: String(e) });
      }

      await context.close();
    }

    const allOk = results.checks.every((c) => c.ok);
    results.ok = allOk;

    await writeFile(
      path.join(outDir, "results.json"),
      JSON.stringify(results, null, 2) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(OUT_ROOT, "latest.json"),
      JSON.stringify(results, null, 2) + "\n",
      "utf8",
    );

    console.log(`Wrote ${path.relative(process.cwd(), outDir)}/results.json`);
    console.log(`Wrote ${path.relative(process.cwd(), OUT_ROOT)}/latest.json`);

    if (!allOk) {
      await writeFile(
        path.join(outDir, "server.log"),
        `# stdout\n${serverStdout}\n\n# stderr\n${serverStderr}\n`,
        "utf8",
      );
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
