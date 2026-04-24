import { chromium } from "playwright-core";

/**
 * Shared Playwright helpers for repo scripts.
 *
 * The smoke / snapshot / compare scripts all reach for the same
 * "launch a headless Chromium, preferring the installed Chrome channel
 * if present, otherwise fall back to the bundled binary" routine, and
 * the same "navigate but tolerate the common transient waitUntil
 * errors" routine. Extracting them removes a dozen lines of boilerplate
 * per script and keeps the launch policy consistent.
 */

export async function launchBrowser(options = {}) {
  const { headless = true, channel = "chrome", ...rest } = options;
  try {
    return await chromium.launch({ channel, headless, ...rest });
  } catch {
    return await chromium.launch({ headless, ...rest });
  }
}

export async function gotoWithFallback(page, url, options = {}) {
  const {
    waitUntil = "domcontentloaded",
    timeout = 30_000,
    fallbackWaitUntil = "commit",
    fallbackTimeout = 20_000,
  } = options;
  try {
    await page.goto(url, { waitUntil, timeout });
    return;
  } catch (error) {
    const msg = String(error || "");
    if (msg.includes("interrupted by another navigation")) {
      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
      return;
    }
    await page.goto(url, { waitUntil: fallbackWaitUntil, timeout: fallbackTimeout });
  }
}
