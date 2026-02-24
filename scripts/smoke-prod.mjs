import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const OUT_ROOT = path.join(process.cwd(), "output", "ui-smoke-prod");

function isoStampForPath(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function normalizeOrigin(origin) {
  const raw = String(origin || "").trim();
  if (!raw) return "https://jinkunchen.com";
  return raw.replace(/\/+$/g, "");
}

function normalizePath(pathname) {
  const p = String(pathname || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.replace(/\/+$/g, "") || "/";
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function main() {
  const origin = normalizeOrigin(process.env.SMOKE_PROD_ORIGIN || "https://jinkunchen.com");
  const searchQuery = String(process.env.SMOKE_PROD_QUERY || "reasoning").trim() || "reasoning";

  const stamp = isoStampForPath();
  const outDir = path.join(OUT_ROOT, stamp);
  await mkdir(outDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    origin,
    searchQuery,
    checks: [],
  };

  const record = (name, ok, details = {}) => {
    report.checks.push({ name, ok, ...details });
  };

  const screenshot = async (page, name) => {
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  };

  let browser = null;

  try {
    browser = await launchBrowser();

    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();

      try {
        await page.goto(`${origin}/`, { waitUntil: "networkidle" });
        await page.hover("#more-trigger");
        await page.waitForTimeout(240);
        const visible = await page.isVisible("#more-menu");
        record("desktop:more-hover-dropdown", visible);
        if (!visible) await screenshot(page, "fail-desktop-more-hover");
      } catch (e) {
        record("desktop:more-hover-dropdown", false, { error: String(e) });
        await screenshot(page, "fail-desktop-more-hover");
      }

      try {
        await page.goto(`${origin}/blog/list`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(250);
        const finalPath = normalizePath(new URL(page.url()).pathname);
        const ok = finalPath === "/blog";
        record("desktop:blog-list-redirect", ok, { finalPath });
        if (!ok) await screenshot(page, "fail-desktop-blog-list-redirect");
      } catch (e) {
        record("desktop:blog-list-redirect", false, { error: String(e) });
        await screenshot(page, "fail-desktop-blog-list-redirect");
      }

      try {
        await page.goto(`${origin}/blog`, { waitUntil: "networkidle" });
        await page.click("#search-trigger");
        await page.waitForSelector("#notion-search.open", { timeout: 5000 });

        const scopeVisible = await page.isVisible("#notion-search-scope:not(.is-hidden)");
        record("desktop:search-scope-visible", scopeVisible);

        await page.fill("#notion-search-input", searchQuery);
        await page
          .waitForFunction(
            () => document.querySelectorAll(".notion-search__result-item").length > 0,
            { timeout: 5000 },
          )
          .catch(() => {});
        const count = await page.locator(".notion-search__result-item").count();
        const hasResults = count > 0;

        let apiCount = null;
        try {
          const r = await fetch(
            `${origin}/api/search?q=${encodeURIComponent(searchQuery)}`,
            { redirect: "follow" },
          );
          const j = await r.json().catch(() => null);
          apiCount = Number.isFinite(Number(j?.items?.length)) ? Number(j.items.length) : null;
        } catch {
          // ignore
        }

        record("desktop:search-has-results", hasResults, {
          uiCount: count,
          apiCount,
        });

        await page.click("#notion-search-clear");
        await page.waitForTimeout(160);
        const clearOk = (await page.inputValue("#notion-search-input")).trim() === "";
        record("desktop:search-clear", clearOk);

        await page.click("#notion-search-close");
        await page.waitForTimeout(250);
        const closeOk = !(await page.isVisible("#notion-search.open"));
        record("desktop:search-close", closeOk);

        if (!scopeVisible || !hasResults || !clearOk || !closeOk) {
          await screenshot(page, "fail-desktop-search");
        }
      } catch (e) {
        record("desktop:search-flow", false, { error: String(e) });
        await screenshot(page, "fail-desktop-search-flow");
      }

      try {
        await page.goto(`${origin}/publications`, { waitUntil: "networkidle" });
        const title = ((await page.locator(".notion-header__title").first().textContent()) || "").trim();
        const ok = /publication/i.test(title);
        record("desktop:publications-title", ok, { title });
        if (!ok) await screenshot(page, "fail-desktop-publications-title");
      } catch (e) {
        record("desktop:publications-title", false, { error: String(e) });
        await screenshot(page, "fail-desktop-publications-title");
      }

      try {
        await page.goto(`${origin}/sitemap`, { waitUntil: "networkidle" });
        const links = await page.locator("main a[href^='/']").count();
        const ok = links >= 10;
        record("desktop:sitemap-has-links", ok, { links });
        if (!ok) await screenshot(page, "fail-desktop-sitemap");
      } catch (e) {
        record("desktop:sitemap-has-links", false, { error: String(e) });
        await screenshot(page, "fail-desktop-sitemap");
      }

      try {
        await page.goto(`${origin}/site-admin`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(260);
        const finalUrl = page.url();
        const ok = finalUrl.includes("/site-admin/login");
        record("desktop:site-admin-protected-redirect", ok, { finalUrl });
        if (!ok) await screenshot(page, "fail-desktop-site-admin-redirect");
      } catch (e) {
        record("desktop:site-admin-protected-redirect", false, { error: String(e) });
        await screenshot(page, "fail-desktop-site-admin-redirect");
      }

      await context.close();
    }

    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();

      try {
        await page.goto(`${origin}/`, { waitUntil: "networkidle" });
        await page.click("#mobile-trigger");
        await page.waitForTimeout(300);

        const menuVisible = await page.isVisible("#mobile-menu");
        record("mobile:menu-open", menuVisible);

        const style = await page
          .locator("#mobile-menu")
          .evaluate((el) => {
            const cs = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
              position: cs.position,
              zIndex: Number(cs.zIndex || "0") || 0,
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              vh: window.innerHeight,
              vw: window.innerWidth,
            };
          })
          .catch(() => null);

        const overlayOk =
          Boolean(style) &&
          style.position === "fixed" &&
          style.top <= 2 &&
          style.left <= 2 &&
          style.width >= style.vw * 0.9 &&
          style.height >= style.vh * 0.4 &&
          style.zIndex >= 40;
        record("mobile:menu-overlay-layout", overlayOk, style || {});

        try {
          await page.click("#mobile-close", { timeout: 2000 });
        } catch {
          await page.click("#mobile-backdrop").catch(() => {});
        }
        await page.waitForTimeout(500);

        const visibleAfter = await page.isVisible("#mobile-menu").catch(() => false);
        const hiddenAfter = await page
          .locator("#mobile-menu")
          .evaluate((el) => el.hidden)
          .catch(() => false);
        const closeOk = !visibleAfter && hiddenAfter;
        record("mobile:menu-close", closeOk, { visibleAfter, hiddenAfter });

        if (!menuVisible || !overlayOk || !closeOk) {
          await screenshot(page, "fail-mobile-menu");
        }
      } catch (e) {
        record("mobile:menu-flow", false, { error: String(e) });
        await screenshot(page, "fail-mobile-menu-flow");
      }

      await context.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  report.ok = report.checks.every((c) => c.ok);
  const resultFile = path.join(outDir, "results.json");
  const latestFile = path.join(OUT_ROOT, "latest.json");
  await writeFile(resultFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Report: ${resultFile}`);
  console.log(`Latest: ${latestFile}`);
  console.log(`Checks: ${report.checks.length}, failed: ${report.checks.filter((c) => !c.ok).length}`);

  if (!report.ok) {
    for (const c of report.checks) {
      if (c.ok) continue;
      const detail = c.error ? ` - ${c.error}` : "";
      console.log(`FAIL ${c.name}${detail}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
