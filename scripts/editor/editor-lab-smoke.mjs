import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const DEFAULT_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = process.env.EDITOR_LAB_URL || "http://127.0.0.1:1440/";
const executablePath = process.env.CHROME_PATH || (existsSync(DEFAULT_CHROME_PATH) ? DEFAULT_CHROME_PATH : undefined);

function hostLoadDocument(document) {
  return {
    document,
    protocolVersion: 1,
    requestId: `smoke-${Math.random().toString(36).slice(2)}`,
    type: "host:load-document",
  };
}

async function loadDocument(page, document) {
  await page.evaluate((message) => window.postMessage(message, window.location.origin), hostLoadDocument(document));
  await page.waitForFunction((title) => document.querySelector(".je-title")?.value === title, document.title);
}

async function selectText(page, selector, start, end) {
  await page.evaluate(
    ({ selector, start, end }) => {
      const editable = document.querySelector(selector);
      if (!editable?.firstChild) throw new Error(`Missing editable text for ${selector}`);
      editable.focus();
      const range = document.createRange();
      range.setStart(editable.firstChild, start);
      range.setEnd(editable.firstChild, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      editable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { selector, start, end },
  );
}

const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(url, { waitUntil: "networkidle" });
assert.equal(await page.locator(".je-block").count(), 10);

await loadDocument(page, {
  version: 1,
  title: "Smoke",
  blocks: [{ id: "a", type: "paragraph", text: [{ text: "Hello world" }] }],
});
await selectText(page, ".je-editable", 0, 5);
await page.getByRole("button", { exact: true, name: "Link" }).click();
await page.getByLabel("URL").fill("/hello");
await page.keyboard.press("Enter");
await page.waitForSelector('.je-editable a[href="/hello"]');

await loadDocument(page, {
  version: 1,
  title: "Slash",
  blocks: [{ id: "a", type: "paragraph", text: [{ text: "" }] }],
});
await page.locator(".je-editable").click();
await page.keyboard.type("/co");
await page.waitForSelector(".je-slash-menu");
const firstSlashItem = await page.locator(".je-slash-menu__item").first().innerText();
assert.match(firstSlashItem, /Code block|Callout/);
await page.keyboard.press("Tab");
await page.waitForSelector(".je-block--code-block, .je-block--callout");

await loadDocument(page, {
  version: 1,
  title: "Enter",
  blocks: [{ id: "h", type: "heading", level: 1, text: [{ text: "Heading" }] }],
});
await selectText(page, ".je-editable", 7, 7);
await page.keyboard.press("Enter");
await page.waitForSelector(".je-block--paragraph");
assert.equal(await page.locator(".je-block--heading").count(), 1);
assert.equal(await page.locator(".je-block--paragraph").count(), 1);

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(url, { waitUntil: "networkidle" });
const mobileMetrics = await page.evaluate(() => ({
  bodyWidth: document.body.scrollWidth,
  viewportWidth: window.innerWidth,
}));
assert.equal(mobileMetrics.bodyWidth, mobileMetrics.viewportWidth);

await browser.close();

if (errors.length) {
  throw new Error(`Editor lab console errors:\n${errors.join("\n")}`);
}

console.log("editor-lab smoke passed");
