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
      if (!editable) throw new Error(`Missing editable text for ${selector}`);
      function textPointAt(root, offset) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let cursor = 0;
        while (node) {
          const next = cursor + node.textContent.length;
          if (offset <= next) return { node, offset: Math.max(0, offset - cursor) };
          cursor = next;
          node = walker.nextNode();
        }
        const fallback = root.lastChild;
        if (fallback?.nodeType === Node.TEXT_NODE) return { node: fallback, offset: fallback.textContent.length };
        throw new Error(`Missing selectable text for ${selector}`);
      }
      editable.focus();
      const range = document.createRange();
      const startPoint = textPointAt(editable, start);
      const endPoint = textPointAt(editable, end);
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);
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
const blockWidths = await page.evaluate(() => {
  const width = (selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().width || 0);
  return {
    callout: width(".je-block--callout .je-editable"),
    image: width(".je-structured-block--image"),
    paragraph: width(".je-block--paragraph .je-editable"),
  };
});
assert.ok(Math.abs(blockWidths.paragraph - blockWidths.callout) <= 1, JSON.stringify(blockWidths));
assert.ok(Math.abs(blockWidths.paragraph - blockWidths.image) <= 1, JSON.stringify(blockWidths));
const headingBlockBox = await page.locator(".je-block--heading").first().boundingBox();
assert.ok(headingBlockBox);
await page.mouse.move(headingBlockBox.x + 10, headingBlockBox.y + 10);
const headingGutterAlignment = await page.evaluate(() => {
  const button = document.querySelector(".je-block--heading .je-block__gutter button");
  const editable = document.querySelector(".je-block--heading .je-editable");
  return Math.abs(button.getBoundingClientRect().top - editable.getBoundingClientRect().top);
});
assert.ok(headingGutterAlignment <= 5, `Heading gutter is misaligned by ${headingGutterAlignment}px`);
await selectText(page, ".je-block--heading .je-editable", 0, 3);
assert.equal(await page.getByRole("button", { exact: true, name: "Block type: Heading 2" }).isVisible(), true);

await loadDocument(page, {
  version: 1,
  title: "Smoke",
  blocks: [{ id: "a", type: "paragraph", text: [{ text: "Hello world" }] }],
});
const blockBox = await page.locator(".je-block").boundingBox();
assert.ok(blockBox);
await page.mouse.move(blockBox.x + 10, blockBox.y + 10);
await page.waitForFunction(() => getComputedStyle(document.querySelector(".je-block__gutter")).opacity === "1");
const hoverState = await page.evaluate(() => {
  const block = document.querySelector(".je-block");
  const gutter = document.querySelector(".je-block__gutter");
  return {
    background: getComputedStyle(block).backgroundColor,
    gutterOpacity: getComputedStyle(gutter).opacity,
  };
});
assert.equal(hoverState.background, "rgba(0, 0, 0, 0)");
assert.equal(hoverState.gutterOpacity, "1");
assert.equal(await page.locator(".je-block__gutter button").count(), 2);
await page.locator(".je-editable").click({ position: { x: 24, y: 16 } });
assert.equal(await page.locator(".je-block").getAttribute("data-selected"), "false");
const editableBox = await page.locator(".je-editable").boundingBox();
assert.ok(editableBox);
await page.mouse.click(editableBox.x + editableBox.width - 8, editableBox.y + 16);
assert.equal(await page.locator(".je-block").getAttribute("data-selected"), "true");
assert.equal(
  await page.locator(".je-block").evaluate((block) => getComputedStyle(block).backgroundColor),
  "rgba(0, 0, 0, 0)",
);
assert.notEqual(
  await page.locator(".je-editable").evaluate((editable) => getComputedStyle(editable).backgroundColor),
  "rgba(0, 0, 0, 0)",
);
await page.locator(".je-editable").click({ position: { x: 24, y: 16 } });
await selectText(page, ".je-editable", 0, 5);
await page.getByRole("button", { exact: true, name: "Link" }).click();
await page.getByLabel("URL").fill("/hello");
await page.keyboard.press("Enter");
await page.waitForSelector('.je-editable a[href="/hello"]');
await page.locator('.je-editable a[href="/hello"]').click();
await page.waitForSelector(".je-link-popover");
await page.getByRole("button", { exact: true, name: "Edit" }).click();
await page.getByLabel("Link URL").fill("/hello-updated");
await page.getByRole("button", { exact: true, name: "Apply" }).click();
await page.waitForSelector('.je-editable a[href="/hello-updated"]');

await loadDocument(page, {
  version: 1,
  title: "Color",
  blocks: [{ id: "a", type: "paragraph", text: [{ text: "Hello world" }] }],
});
await selectText(page, ".je-editable", 0, 5);
await page.getByRole("button", { exact: true, name: "Text color" }).click();
await page.getByRole("button", { exact: true, name: "Text color blue" }).click();
await page.waitForSelector('.je-editable span[data-color="blue"]');
await selectText(page, ".je-editable", 0, 5);
const textColorButton = page.getByRole("button", { exact: true, name: "Text color" });
assert.equal(await textColorButton.getAttribute("aria-pressed"), "true");
assert.equal(await textColorButton.getAttribute("data-current-color"), "blue");
await selectText(page, ".je-editable", 0, 11);
assert.equal(await textColorButton.getAttribute("aria-pressed"), "false");
assert.equal(await textColorButton.getAttribute("data-mixed"), "true");

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
