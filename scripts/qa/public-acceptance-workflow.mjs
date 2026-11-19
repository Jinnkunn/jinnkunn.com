import assert from "node:assert/strict";
import { normalizePublicCalendarRuntimeData } from "@jinnkunn/calendar-core/public";
import { ensureNextBuild, findAvailablePort, startNextServer, waitForHttp } from "../_lib/local-next.mjs";
import { launchBrowser } from "../_lib/playwright.mjs";

const calendarNow = "2026-11-19T12:00:00.000Z";
const calendarFixture = normalizePublicCalendarRuntimeData({
  generatedAt: calendarNow,
  observationSnapshot: { revision: 42, eventIds: [], busyComplete: true },
  events: ["20", "27"].map((day) => ({
    id: "same-legacy-id", visibility: "busy", isAllDay: false,
    startsAt: `2026-11-${day}T14:00:00Z`, endsAt: `2026-11-${day}T15:00:00Z`,
  })).concat({
    id: "existing-link", title: "Calendar fixture talk", visibility: "full", isAllDay: false,
    description: "#talk",
    startsAt: "2026-11-28T14:00:00Z", endsAt: "2026-11-28T15:00:00Z",
  }),
});

async function checkCalendar(page, origin, viewport, setFeed, delayFeed) {
  const mobile = viewport.width <= 720;
  setFeed("stale");
  const releaseFeed = delayFeed();
  try {
    const response = await page.goto(`${origin}/calendar?tz=UTC`);
    assert.match(await page.title(), /Calendar/);
    assert.doesNotMatch(await response.text(), /class="public-calendar__range-title"/, "Prerendered HTML does not present an outdated date");
    await page.getByRole("button", { name: mobile ? "Agenda" : "Month", exact: true, pressed: true }).waitFor();
    const range = page.locator(".public-calendar__range-title");
    assert.equal(await range.innerText(), mobile ? "Nov 19 - Dec 18, 2026" : "November 2026", "The first date renders without waiting for the feed");
  } finally {
    releaseFeed();
  }
  await page.waitForFunction(() => document.querySelector('select[aria-label="Time zone"]')?.value === "UTC");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Busy", exact: true });
  const slots = page.locator(".public-calendar__day").filter({ has: page.getByRole("button", { name: /Busy/ }) });
  const freshness = page.getByText(/Unlisted times are not confirmed as free/);
  await freshness.waitFor();
  assert.equal(await freshness.locator("time").count(), 1, "Old Live data reports its true verification time");
  const previous = page.getByRole("button", { name: "Previous calendar range" });
  const next = page.getByRole("button", { name: "Next calendar range" });
  const today = page.getByRole("button", { name: "Today", exact: true });
  const options = page.getByRole("button", { name: "Calendar options", exact: true });
  const timeZone = page.getByLabel("Time zone", { exact: true });
  const subscribe = page.getByRole("link", { name: "Subscribe", exact: true });
  if (mobile) {
    assert.equal(await options.getAttribute("aria-expanded"), "false");
    assert.equal(await timeZone.isVisible(), false);
    assert.equal(await subscribe.isVisible(), false);
    for (const control of [previous, today, next, options]) {
      const box = await control.boundingBox();
      assert.ok(box?.width >= 44 && box.height >= 44, "Calendar touch targets are at least 44 by 44 CSS pixels");
    }
    await options.click();
    assert.equal(await options.getAttribute("aria-expanded"), "true");
  }
  await timeZone.selectOption("America/Toronto");
  assert.equal(new URL(page.url()).searchParams.get("tz"), "America/Toronto");
  await timeZone.selectOption("UTC");
  assert.equal(await subscribe.getAttribute("href"), "webcal://jinkunchen.com/api/public/calendar/calendar.ics");
  await page.getByRole("button", { name: "90 days", exact: true }).click();
  assert.equal(await page.locator(".public-calendar__range-title").innerText(), "Nov 19, 2026 - Feb 16, 2027");
  await page.getByRole("button", { name: "30 days", exact: true }).click();
  await page.getByRole("button", { name: "Featured", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("scope"), "featured");
  const tag = page.getByRole("button", { name: "#talk", exact: true });
  await tag.click();
  assert.equal(new URL(page.url()).searchParams.get("tag"), "talk");
  assert.equal(await slots.count(), 0);
  if (mobile) {
    await page.keyboard.press("Escape");
    assert.equal(await options.getAttribute("aria-expanded"), "false");
    assert.equal(await options.getAttribute("data-filtered"), "true");
    assert.equal(await options.evaluate((button) => button === document.activeElement), true);
    await options.click();
  }
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  if (mobile) await options.click();
  await next.click();
  await page.getByText("No public events in this range.", { exact: true }).waitFor();
  assert.equal(await slots.count(), 0);
  await previous.click();
  await slots.first().waitFor();
  assert.equal(await slots.count(), 2);
  await next.click();
  await today.click();
  await slots.first().waitFor();
  setFeed("offline");
  const offline = page.waitForResponse((response) => response.url() === `${origin}/api/public/calendar` && response.status() === 503);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await offline;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await slots.count(), 2, "Network failures do not discard the last known Busy slots");
  for (const [index, day] of ["20", "27"].entries()) {
    const slot = slots.nth(index).getByRole("button", { name: /Busy/ });
    await slot.click();
    await dialog.waitFor();
    assert.match(await dialog.innerText(), new RegExp(`November ${day}, 2026`));
    assert.equal(await slot.getAttribute("aria-pressed"), "true");
    assert.equal(await slots.nth(1 - index).getByRole("button", { name: /Busy/ }).getAttribute("aria-pressed"), "false");
    assert.equal(await dialog.getByRole("link").count(), 0);
    if (index === 1) await page.screenshot({ path: `/tmp/public-acceptance-calendar-${viewport.width}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "Close event details" }).click();
  }
  await page.getByRole("button", { name: /Calendar fixture talk/ }).click();
  const talk = page.getByRole("dialog", { name: "Calendar fixture talk", exact: true });
  assert.equal(await talk.getByRole("link", { name: "Open event page" }).getAttribute("href"), "/calendar/existing-link");
  setFeed("fresh");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await freshness.waitFor({ state: "hidden" });
  await talk.getByRole("button", { name: "Close event details" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  if (mobile) {
    const firstDay = await page.locator(".public-calendar__day-title").first().boundingBox();
    assert.ok(firstDay?.y < 420, `Agenda content starts near the top (first date y=${firstDay?.y})`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `/tmp/calendar-toolbar-${viewport.width}.png`, animations: "disabled" });
  if (mobile) {
    await options.click();
    await page.screenshot({ path: `/tmp/calendar-options-${viewport.width}.png`, animations: "disabled" });
  }
}

async function main() {
  Object.assign(process.env, { SITE_ADMIN_STORAGE: "local", CONTENT_SYNC_MODE: "stubs", NEXTAUTH_SECRET: "public-acceptance-fixture", CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" });
  ensureNextBuild();
  const port = await findAvailablePort(), origin = `http://127.0.0.1:${port}`;
  const server = startNextServer({ port });
  let browser, page, searchFailure = false, calendarMode = "fresh", calendarGate;
  const setFeed = (mode) => { calendarMode = mode; };
  const delayFeed = () => {
    let resolve;
    calendarGate = new Promise((done) => { resolve = done; });
    return () => { resolve(); calendarGate = undefined; };
  };
  const errors = [], warnings = [];
  try {
    await waitForHttp(origin);
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort("blockedbyclient");
      assert.equal(request.method(), "GET", "Public acceptance never writes data");
      if (url.pathname === "/api/search" && searchFailure) return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Isolated search failure"}' });
      if (url.pathname === "/api/public/calendar") {
        if (calendarGate) await calendarGate;
        const headers = { "X-Calendar-Served-At": calendarNow };
        if (calendarMode === "offline") return route.fulfill({ status: 503, headers, json: { error: "Fixture unavailable" } });
        const stale = calendarMode === "stale";
        const verifiedAt = new Date(Date.parse(calendarNow) - (stale ? 7 * 3_600_000 : 0)).toISOString();
        const observationSnapshot = { ...calendarFixture.observationSnapshot, revision: stale ? 42 : 43, verifiedAt };
        return route.fulfill({ json: { ...calendarFixture, observationSnapshot }, headers });
      }
      return route.continue();
    });
    const watchPage = (target) => {
      target.setDefaultTimeout(12_000);
      target.on("pageerror", (error) => errors.push({ path: new URL(target.url()).pathname, message: error.message }));
      target.on("console", (message) => { if (message.type() === "error") warnings.push(message.text()); });
    };
    const checkCalendarInViewport = async (viewport) => {
      const calendar = await context.newPage();
      watchPage(calendar);
      await calendar.setViewportSize(viewport);
      await calendar.clock.setFixedTime(new Date(calendarNow));
      try {
        await checkCalendar(calendar, origin, viewport, setFeed, delayFeed);
      } catch (error) {
        await calendar.screenshot({ path: `/tmp/calendar-failure-${viewport.width}.png` }).catch(() => {});
        throw error;
      } finally {
        await calendar.close();
      }
    };
    page = await context.newPage();
    watchPage(page);
    await page.goto(`${origin}/blog`);
    assert.match(await page.title(), /Blog/);
    await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Blog", exact: true }).waitFor();
    await page.locator("#more-trigger").click();
    await page.locator("#more-menu").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#more-menu").waitFor({ state: "hidden" });
    await page.goto(origin);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.locator("#search-trigger").click();
      await page.locator("#notion-search.open").waitFor();
      const input = page.locator("#notion-search-input");
      await input.fill("义门陈");
      await page.locator('.notion-search__result-item[href="/chen"]').waitFor();
      await input.fill("Ｔｅａｃｈｉｎｇ");
      await page.locator('.notion-search__result-item[href="/teaching"]').waitFor();
      await input.fill("qa-no-result-291837");
      await page.getByText("No results", { exact: true }).waitFor();
      searchFailure = true;
      await input.fill("Works");
      await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
      searchFailure = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.locator('.notion-search__result-item[href="/works"]').waitFor();
      assert.equal(await page.locator(".notion-search__result-item").first().getAttribute("href"), "/works", "Exact navigation matches lead the displayed groups");
      await page.locator("#notion-search.open").waitFor();
      const group = page.locator(".notion-search__group").first();
      await group.click();
      await page.locator("#notion-search.open").waitFor();
      await page.locator(".notion-search__group").first().click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/public-acceptance-search-${viewport.width}.png` });
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#search-trigger").evaluate((el) => el === document.activeElement), true);

      const paperTitle = "Maritime tracking data analysis and integration with AISDB";
      await page.locator("#search-trigger").click();
      await input.fill(paperTitle);
      const hit = page.locator('.notion-search__result-item[href^="/publications#paper-"]').filter({ hasText: paperTitle });
      const href = await hit.getAttribute("href");
      assert.equal(await page.locator(".notion-search__result-item").first().getAttribute("href"), href);
      assert.match(await hit.innerText(), /2024/);
      await hit.click();
      await page.waitForURL(`${origin}${href}`);
      const anchor = href.split("#")[1];
      const row = page.locator(`[id="${anchor}"]`);
      const toggle = row.getByRole("button", { name: `Authors of ${paperTitle}`, exact: true });
      const authors = row.locator(".notion-toggle__content");
      await authors.waitFor({ state: "visible" });
      await page.waitForFunction((id) => {
        const box = document.getElementById(id)?.getBoundingClientRect();
        return box && box.top >= -4 && box.top < window.innerHeight / 2;
      }, anchor);
      await toggle.press("Enter");
      await authors.waitFor({ state: "hidden" });
      await toggle.press("Space");
      await authors.waitFor({ state: "visible" });
      assert.match(await authors.innerText(), /G\. Spadon/);
      assert.equal(await authors.getByRole("link").count(), 0);
      assert.deepEqual(await row.locator(".pub-type-tag").allTextContents(), ["Journal"]);
      assert.deepEqual(await row.getByRole("group", { name: "Publication resources" }).getByRole("link").allTextContents(), ["DOI", "arXiv"]);
      assert.equal(await row.evaluate((element) => {
        const badges = element.querySelector(".pub-meta-line")?.getBoundingClientRect();
        const venue = element.querySelector(".pub-venue-line")?.getBoundingClientRect();
        return Boolean(badges && venue && venue.top >= badges.bottom - 1);
      }), true);
      const preprint = page.locator(".publication-toggle").filter({
        has: page.locator(".pub-title-text").filter({ hasText: /^Static Sandboxes/ }),
      });
      assert.deepEqual(await preprint.locator(".pub-type-tag").allTextContents(), ["Preprint"]);
      assert.equal(await preprint.locator(".pub-venue-line").count(), 0, "A repository is not repeated as a venue for a link-only preprint");
      const preprintLinks = preprint.getByRole("group", { name: "Publication resources" }).getByRole("link");
      assert.deepEqual(await preprintLinks.allTextContents(), ["arXiv"]);
      assert.equal(await preprintLinks.first().getAttribute("href"), "https://arxiv.org/abs/2510.13982");
      assert.equal(await row.getByRole("link", { name: `Link to ${paperTitle}` }).getAttribute("href"), `#${anchor}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/public-acceptance-publication-${viewport.width}.png`, animations: "disabled" });

      await page.locator("#search-trigger").click();
      await input.fill("CAB-KWS");
      const samePageHit = page.locator('.notion-search__result-item[href^="/publications#paper-"]').filter({ hasText: "CAB-KWS" });
      const samePageHref = await samePageHit.getAttribute("href");
      await samePageHit.click();
      await page.waitForURL(`${origin}${samePageHref}`);
      await page.locator("#notion-search.open").waitFor({ state: "hidden" });
      await page.waitForFunction((id) => {
        const box = document.getElementById(id)?.getBoundingClientRect();
        return box && box.top >= -4 && box.top < window.innerHeight / 2;
      }, samePageHref.split("#")[1]);
      const cab = page.locator(`[id="${samePageHref.split("#")[1]}"]`);
      assert.deepEqual(await cab.locator(".pub-type-tag").allTextContents(), ["Conference", "Journal"]);
      assert.match((await cab.locator(".pub-venue-line").allTextContents())[1], /Lecture Notes in Computer Science/);
      const longTitle = cab.locator(".pub-title-line");
      assert.equal(await longTitle.evaluate((element) => {
        const title = element.querySelector(".pub-title-text")?.getBoundingClientRect();
        const link = element.querySelector(".pub-permalink")?.getBoundingClientRect();
        return Boolean(title && link && Math.abs(link.top - title.top) < 2 && link.left >= title.right);
      }), true, "A long title must not push its permalink onto an empty line");

      await page.goto(`${origin}/bio`);
      const reading = page.getByRole("region", { name: "Selected research reading" });
      assert.equal(await reading.getByRole("link", { name: paperTitle, exact: true }).getAttribute("href"), href);
      assert.equal(await page.getByRole("link", { name: "Latest term", exact: true }).getAttribute("href"), "/teaching#latest-term");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await reading.screenshot({ path: `/tmp/public-acceptance-bio-reading-${viewport.width}.png`, animations: "disabled" });
      await page.goto(`${origin}/teaching`);
      const latest = page.getByRole("region", { name: "Latest term", exact: true });
      await latest.getByRole("heading", { level: 3 }).waitFor();
      assert.equal(await latest.getAttribute("id"), "latest-term");
      assert.equal(await latest.getByRole("link", { name: /CSCI 4152\/6509.*Natural Language Processing/ }).getAttribute("href"), "https://vlado.cs.dal.ca/csci6509/");
      await page.getByRole("region", { name: "Past terms", exact: true }).waitFor();
      const teachingBody = page.locator(".mdx-post__body");
      assert.equal(await teachingBody.locator('a[href="/teaching/archive"]').count(), 1);
      assert.equal(await teachingBody.getByRole("link", { name: "CSCI3141", exact: true }).getAttribute("href"), "/teaching/archive/2024-25-fall/csci3141");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/public-acceptance-teaching-${viewport.width}.png`, animations: "disabled" });
      await page.goto(`${origin}/blog`);
      const series = page.getByRole("navigation", { name: "Reasoning Drift", exact: true });
      assert.deepEqual(await series.getByRole("link").allTextContents(), ["Recognizing reasoning drift", "Measuring drift at the token level", "Testing context order"]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await series.screenshot({ path: `/tmp/public-acceptance-blog-series-${viewport.width}.png`, animations: "disabled" });
      await series.getByRole("link", { name: "Recognizing reasoning drift", exact: true }).click();
      await page.waitForURL("**/blog/when-ai-reasoning-starts-to-drift");
      assert.equal(await series.locator('[aria-current="page"]').innerText(), "Recognizing reasoning drift");
      await checkCalendarInViewport(viewport);
      await page.goto(origin);
    }
    const narrowViewport = { width: 320, height: 740 };
    await checkCalendarInViewport(narrowViewport);
    const missing = await page.goto(`${origin}/qa-page-that-does-not-exist-291837`);
    assert.equal(missing.status(), 404);
    await page.getByRole("heading", { name: /not found/i }).waitFor();
    await page.getByRole("link", { name: "Back home", exact: true }).click();
    await page.waitForURL(`${origin}/`);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings.filter((message) => !/ERR_BLOCKED_BY_CLIENT|status of (503|404)/.test(message)), []);
    console.log("[public-acceptance] PASS: desktop/mobile bilingual search, paper links and keyboard disclosure, BIO reading, Teaching terms, blog series, calendar occurrences, retry, More dismissal, 404 recovery, zero writes");
  } catch (error) {
    console.error({ errors, warnings });
    console.error(server.getLogs());
    if (page) { await page.screenshot({ path: "/tmp/public-acceptance-failure.png" }).catch(() => {}); console.error((await page.locator("body").innerText().catch(() => "")).slice(-1200)); }
    throw error;
  } finally {
    await browser?.close(); await server.stop();
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
