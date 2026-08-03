#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { chromium } from "playwright-core";

import { parseArgs } from "../_lib/cli.mjs";
import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { gotoWithFallback } from "../_lib/playwright.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";

function log(message) {
  console.log(`[site-admin-editor-interaction] ${message}`);
}

function cookiePairs(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return { name: part.slice(0, separator), value: part.slice(separator + 1) };
    })
    .filter((cookie) => cookie.name && cookie.value);
}

async function main() {
  loadProjectEnv({ override: false });
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(
    args.baseUrl || process.env.SITE_ADMIN_BASE_URL || "http://127.0.0.1:3000",
  ).replace(/\/+$/, "");
  const desktopScreenshot = String(
    args.desktopScreenshot || "/tmp/site-admin-editor-interaction.png",
  );
  const compactScreenshot = String(
    args.compactScreenshot || "/tmp/site-admin-editor-interaction-compact.png",
  );
  const auth = await createNextAuthSessionCookie({
    maxAge: 60 * 15,
    subjectPrefix: "editor-interaction",
  });
  assert.equal(auth.ok, true, auth.reason || "Unable to create Site Admin session");

  const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  log("launching browser");
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const localHttp = baseUrl.startsWith("http://");
  await context.addCookies(
    cookiePairs(auth.cookie)
      .filter((cookie) => !(localHttp && cookie.name.startsWith("__Secure-")))
      .map((cookie) => ({ ...cookie, url: baseUrl })),
  );
  log("browser session ready");
  const page = await context.newPage();
  let writeAttempts = 0;
  await page.route("**/api/site-admin/components/*", async (route) => {
    if (route.request().method() === "GET") {
      await route.continue();
      return;
    }
    writeAttempts += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "QA write intentionally blocked" }),
    });
  });

  try {
    log(`opening ${baseUrl}/site-admin`);
    await gotoWithFallback(page, `${baseUrl}/site-admin`);
    log(
      `site admin loaded; url=${page.url()}; text=${(await page.locator("body").innerText()).slice(0, 180).replace(/\s+/g, " ")}`,
    );
    await page.getByRole("heading", { name: "Content" }).waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: /^News\b/ }).last().click();
    await page.getByRole("heading", { name: "News entries" }).waitFor();

    await page.getByRole("button", { name: "Add update" }).click();
    const form = page.locator("[data-structured-entry-form]").first();
    await form.waitFor();
    const body = form.locator('[data-component-field="body"]');
    await body.fill("");
    await page.getByRole("button", { name: /Review 1/ }).click();
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("data-component-field")),
      "body",
    );

    await body.fill("Interaction smoke update. This value is never saved.");
    await body.press("Meta+Enter");
    await page.waitForTimeout(50);
    assert.equal(await form.isVisible(), false, "Command+Enter should collapse the entry");

    const card = page.locator("details[data-invalid]").first();
    await card.locator("summary").click();
    await page.screenshot({ path: desktopScreenshot, fullPage: false });
    const beforeDuplicate = await page.locator("details[data-invalid]").count();
    await card.getByRole("button", { name: "Duplicate" }).click();
    assert.equal(
      await page.locator("details[data-invalid]").count(),
      beforeDuplicate + 1,
      "Duplicate should add one entry",
    );

    page.once("dialog", (dialog) => dialog.accept());
    const duplicateCard = page.locator("details[data-invalid]").first();
    await duplicateCard.getByRole("button", { name: "Delete" }).click();
    assert.equal(
      await page.locator("details[data-invalid]").count(),
      beforeDuplicate,
      "Delete should remove the duplicate",
    );

    await page.setViewportSize({ width: 720, height: 900 });
    await page.waitForTimeout(100);
    const overflowsViewport = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    assert.equal(overflowsViewport, false, "Compact editor should not overflow horizontally");
    await page.screenshot({ path: compactScreenshot, fullPage: false });

    log(
      `passed against ${baseUrl}; blocked backend writes=${writeAttempts}; screenshots=${desktopScreenshot},${compactScreenshot}`,
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    `[site-admin-editor-interaction] FAIL: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
});
