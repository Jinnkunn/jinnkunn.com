import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const OUT_ROOT = path.join(process.cwd(), "output", "ui-smoke");

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
    env: { ...process.env, PORT: String(port) },
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
  const stamp = isoStampForPath();
  const outDir = path.join(OUT_ROOT, stamp);
  await mkdir(outDir, { recursive: true });

  const port = 3011;
  const baseURL = `http://localhost:${port}`;

  const results = {
    generatedAt: new Date().toISOString(),
    baseURL,
    checks: [],
  };

  const record = (name, ok, details = {}) => {
    results.checks.push({ name, ok, ...details });
  };

  let server = null;
  let browser = null;

  try {
    ensureBuild();
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
      });
      const page = await context.newPage();
      await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });

      // More hover shows dropdown
      try {
        await page.hover("#more-trigger");
        await page.waitForTimeout(200);
        const visible = await page.isVisible("#more-menu");
        record("desktop:more-hover-dropdown", visible);
        if (!visible) {
          await page.screenshot({
            path: path.join(outDir, "fail-desktop-more-hover.png"),
            fullPage: true,
          });
        }
      } catch (e) {
        record("desktop:more-hover-dropdown", false, { error: String(e) });
      }

      // Search modal basics: open, scope pill, results, clear, close
      try {
        await page.goto(`${baseURL}/blog`, { waitUntil: "networkidle" });
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
        await page.screenshot({
          path: path.join(outDir, "fail-desktop-search.png"),
          fullPage: true,
        });
      }

      await context.close();
    }

    // Mobile checks
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });

      // Open menu
      try {
        await page.click("#mobile-trigger");
        const open = await page.isVisible("#mobile-menu");
        record("mobile:menu-open", open);
        if (!open) {
          await page.screenshot({
            path: path.join(outDir, "fail-mobile-menu-open.png"),
            fullPage: true,
          });
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
      const url = `${baseURL}/blog/context-order-and-reasoning-drift-measuring-order-sensitivity-from-token-probabilities`;
      await page.goto(url, { waitUntil: "networkidle" });

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

    // Embed loader hides (separate page that includes embeds)
    {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
      });
      const page = await context.newPage();
      const url = `${baseURL}/blog/list/do-language-model-embeddings-form-an-approximate-abelian-group`;
      await page.goto(url, { waitUntil: "networkidle" });

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

    // References typography (ensure it's not oversized)
    {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
      });
      const page = await context.newPage();
      const url = `${baseURL}/blog/list/the-effect-of-chunk-retrieval-sequence-in-rag-on-multi-step-inference-performance-of-large-language-models`;
      await page.goto(url, { waitUntil: "networkidle" });

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
