import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLASSIC_LINK_ICON_CONTRACT } from "./_lib/classic-link-icons.mjs";
import {
  ensureNextBuild,
  findAvailablePort,
  sleep,
  startNextServer,
  waitForHttp,
} from "./_lib/local-next.mjs";
import { gotoWithFallback, launchBrowser } from "./_lib/playwright.mjs";

const ROOT = process.cwd();
const BLOG_STABLE_POST =
  "/blog/context-order-and-reasoning-drift-measuring-order-sensitivity-from-token-probabilities";

const CLASSIC_ROUTES = [
  {
    path: "/",
    pageClass: "page__index",
    titleIncludes: "Hi there!",
    expectedLinks: 8,
    kind: "home",
  },
  {
    path: "/blog",
    pageClass: "page__blog",
    titleIncludes: "Blog",
    expectedLinks: 1,
  },
  {
    path: BLOG_STABLE_POST,
    pageClass: "page__blog-post",
    titleIncludes: "Context Order",
    expectedLinks: 0,
    breadcrumbs: true,
  },
  {
    path: "/news",
    pageClass: "page__mdx-page",
    titleIncludes: "News",
    expectedLinks: 0,
  },
  {
    path: "/publications",
    pageClass: "page__mdx-page",
    titleIncludes: "Publications",
    expectedLinks: 3,
  },
  {
    path: "/teaching",
    pageClass: "page__mdx-page",
    titleIncludes: "Teaching",
    expectedLinks: 1,
  },
  {
    path: "/works",
    pageClass: "page__mdx-page",
    titleIncludes: "Works",
    expectedLinks: 1,
  },
  {
    path: "/chen",
    pageClass: "page__mdx-page",
    titleIncludes: "Yimen Chen",
    expectedLinks: 0,
    breadcrumbs: true,
  },
];

const BLOG_RSS_LINK_BASELINE = {
  path: "/blog",
  name: "Blog RSS",
  selector: 'span[data-link-style="icon"] > a[href="/blog.rss"].notion-link.link',
  icon: true,
};

const CONTENT_LINK_STYLE_SAMPLES = [
  {
    path: "/",
    name: "Home regular link",
    selector: 'a[href="https://exorcat.com/"].notion-link.link',
    icon: false,
  },
  {
    path: "/",
    name: "Home icon link",
    selector: 'span[data-link-style="icon"] > a[href="/blog"].notion-link.link',
    icon: true,
  },
  {
    path: "/publications",
    name: "Publications icon link",
    selector: 'span[data-link-style="icon"] > a[href*="scholar.google"].notion-link.link',
    icon: true,
  },
  {
    path: "/teaching",
    name: "Teaching icon link",
    selector: 'span[data-link-style="icon"] > a[href="/teaching/archive"].notion-link.link',
    icon: true,
  },
];

function assert(condition, message, details = {}) {
  if (condition) return;
  const payload = details && typeof details === "object" ? details : {};
  const suffix = Object.keys(payload).length ? `\n${JSON.stringify(payload, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

function assertBetween(value, min, max, message, details = {}) {
  assert(value >= min && value <= max, message, { value, min, max, ...details });
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    homeOnly: argv.includes("--home-only"),
    skipBuild: argv.includes("--skip-build"),
    port: argv.find((arg) => arg.startsWith("--port="))?.slice("--port=".length),
  };
}

function routeTargets({ homeOnly }) {
  return homeOnly ? CLASSIC_ROUTES.filter((route) => route.kind === "home") : CLASSIC_ROUTES;
}

async function readRouteContract(page, pageClass) {
  return await page.evaluate((targetClass) => {
    const rectOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    };
    const styleOf = (selector, pseudo = null) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = window.getComputedStyle(node, pseudo);
      return {
        color: style.color,
        content: style.content,
        display: style.display,
        fontSize: style.fontSize,
        height: style.height,
        lineHeight: style.lineHeight,
        marginBottom: style.marginBottom,
        textDecorationLine: style.textDecorationLine,
        width: style.width,
        backgroundImage: style.backgroundImage,
      };
    };
    const firstReadable = document.querySelector(
      ".notion-root p, .notion-root li, .notion-root blockquote, .notion-root .mdx-post__body",
    );
    const firstReadableStyle = firstReadable
      ? {
          fontSize: getComputedStyle(firstReadable).fontSize,
          lineHeight: getComputedStyle(firstReadable).lineHeight,
        }
      : null;
    const firstLink = document.querySelector(".notion-root a.notion-link.link");
    const firstLinkStyle = firstLink
      ? {
          href: firstLink.getAttribute("href"),
          color: getComputedStyle(firstLink).color,
          textDecorationLine: getComputedStyle(firstLink).textDecorationLine,
        }
      : null;

    return {
      pathname: window.location.pathname,
      viewportWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainIds: document.querySelectorAll("#main-content").length,
      mainClassName: document.querySelector("#main-content")?.className || "",
      hasTargetPageClass: Boolean(document.querySelector(`#main-content.${targetClass}`)),
      titleText:
        document.querySelector(".notion-header__title")?.textContent?.trim() || "",
      root: rectOf(`.${targetClass} .notion-root.max-width`),
      headerContent: rectOf(`.${targetClass} .notion-header__content.max-width`),
      cover: rectOf(`.${targetClass} .notion-header__cover`),
      articleStyle: styleOf(`.${targetClass} .notion-root.max-width`),
      firstReadableStyle,
      firstLinkStyle,
      linkCount: document.querySelectorAll(".notion-root a.notion-link.link").length,
      breadcrumbCount: document.querySelectorAll(".super-navbar__breadcrumbs .notion-breadcrumb__item").length,
    };
  }, pageClass);
}

async function readHomeContract(page) {
  return await page.evaluate(() => {
    const rectOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    };
    const styleOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = window.getComputedStyle(node);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        marginBottom: style.marginBottom,
      };
    };
    return {
      classicIntro: rectOf(".home-layout--variant-classicIntro"),
      introImage: rectOf(
        ".home-layout--variant-classicIntro .home-layout__column:first-child img",
      ),
      introText: rectOf(
        ".home-layout--variant-classicIntro .home-layout__column:nth-child(2)",
      ),
      introParagraph: styleOf(
        ".home-layout--variant-classicIntro .home-layout__column:nth-child(2) :is(p, span[data-color])",
      ),
      bodyParagraph: styleOf(
        ".page__index .mdx-post__body > :is(p, span[data-color])",
      ),
    };
  });
}

async function readMobileHomeContract(page) {
  return await page.evaluate(() => {
    const rectOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      image: rectOf(
        ".home-layout--variant-classicIntro .home-layout__column:first-child img",
      ),
      text: rectOf(
        ".home-layout--variant-classicIntro .home-layout__column:nth-child(2)",
      ),
    };
  });
}

function assertClassicRoute(route, contract) {
  assert(contract.mainIds === 1, `${route.path} must have exactly one main-content id`, {
    mainIds: contract.mainIds,
  });
  assert(contract.hasTargetPageClass, `${route.path} lost its page class`, {
    expected: route.pageClass,
    mainClassName: contract.mainClassName,
  });
  assert(
    contract.titleText.includes(route.titleIncludes),
    `${route.path} title drifted`,
    { titleText: contract.titleText, expected: route.titleIncludes },
  );
  assertBetween(
    contract.root?.width ?? 0,
    899,
    901,
    `${route.path} root width drifted on large screens`,
  );
  assertBetween(
    contract.headerContent?.width ?? 0,
    899,
    901,
    `${route.path} header width drifted on large screens`,
  );
  assertBetween(
    contract.cover?.height ?? 0,
    139,
    141,
    `${route.path} cover spacer height drifted`,
  );
  const expectedX = (contract.viewportWidth - (contract.root?.width ?? 0)) / 2;
  assertBetween(
    contract.root?.x ?? -1,
    expectedX - 1,
    expectedX + 1,
    `${route.path} root is no longer centered`,
  );
  assert(
    contract.firstReadableStyle?.fontSize === "16px",
    `${route.path} readable body font size drifted`,
    contract.firstReadableStyle ?? {},
  );
  const rawLineHeight = contract.firstReadableStyle?.lineHeight || "";
  const lineHeight = Number.parseFloat(rawLineHeight);
  assert(
    rawLineHeight === "normal" || (lineHeight >= 20 && lineHeight <= 28),
    `${route.path} readable body line height drifted`,
    contract.firstReadableStyle ?? {},
  );
  assert(
    contract.linkCount >= route.expectedLinks,
    `${route.path} has fewer styled Notion links than expected`,
    { linkCount: contract.linkCount, expectedLinks: route.expectedLinks },
  );
  if (contract.firstLinkStyle) {
    assert(
      contract.firstLinkStyle.color !== "rgb(0, 0, 238)",
      `${route.path} link color fell back to browser default blue`,
      contract.firstLinkStyle,
    );
    assert(
      String(contract.firstLinkStyle.textDecorationLine || "").includes("underline"),
      `${route.path} link underline style drifted`,
      contract.firstLinkStyle,
    );
  }
  if (route.breadcrumbs) {
    assert(
      contract.breadcrumbCount >= 2,
      `${route.path} breadcrumbs disappeared`,
      { breadcrumbCount: contract.breadcrumbCount },
    );
  }
}

function assertHomeDesktop(contract) {
  assertBetween(
    contract.classicIntro?.width ?? 0,
    700,
    716,
    "Homepage classic intro content width drifted",
  );
  assertBetween(
    contract.introImage?.width ?? 0,
    219,
    221,
    "Homepage classic intro image width drifted",
  );
  assertBetween(
    contract.introText?.width ?? 0,
    430,
    452,
    "Homepage classic intro text column width drifted",
  );
  assert(
    contract.introParagraph?.fontSize === "16px" &&
      contract.introParagraph?.lineHeight === "24px",
    "Homepage classic intro typography drifted",
    contract.introParagraph,
  );
  assert(
    contract.bodyParagraph?.fontSize === "16px" &&
      contract.bodyParagraph?.lineHeight === "24px" &&
      contract.bodyParagraph?.marginBottom === "32px",
    "Homepage classic body paragraph rhythm drifted",
    contract.bodyParagraph,
  );
}

function assertMobileRoute(route, contract) {
  assert(
    contract.scrollWidth <= contract.clientWidth + 1,
    `${route.path} overflows horizontally on mobile`,
    contract,
  );
  assert(
    contract.root && contract.root.width <= contract.clientWidth + 1,
    `${route.path} root exceeds mobile viewport`,
    contract,
  );
}

function assertMobileHome(contract) {
  assertBetween(
    contract.image?.width ?? 0,
    340,
    344,
    "Homepage classic intro image width drifted on mobile",
  );
  assert(
    (contract.text?.y ?? 0) > (contract.image?.y ?? 0),
    "Homepage classic intro should stack image before text on mobile",
    contract,
  );
}

async function assertIcon(page, item) {
  const icon = await page.evaluate((selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const style = window.getComputedStyle(node, "::before");
    return {
      content: style.content,
      display: style.display,
      backgroundImage: style.backgroundImage,
      width: style.width,
      height: style.height,
    };
  }, item.selector);

  assert(icon, `${item.name} link icon selector was not found`, item);
  assert(icon.content === '""', `${item.name} link icon pseudo-element is missing`, icon);
  assert(icon.display !== "none", `${item.name} link icon is hidden`, icon);
  assert(
    icon.backgroundImage.includes(item.asset),
    `${item.name} link icon uses the wrong asset`,
    icon,
  );
}

async function readLinkStyle(page, selector) {
  return await page.evaluate((targetSelector) => {
    const node = document.querySelector(targetSelector);
    if (!node) return null;
    const style = window.getComputedStyle(node);
    const before = window.getComputedStyle(node, "::before");
    return {
      color: style.color,
      opacity: style.opacity,
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      textDecorationColor: style.textDecorationColor,
      textDecorationLine: style.textDecorationLine,
      before: {
        content: before.content,
        display: before.display,
        backgroundImage: before.backgroundImage,
      },
    };
  }, selector);
}

async function readLinkInteraction(page, item) {
  await page.waitForSelector(item.selector, { timeout: 10_000 });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(80);
  const normal = await readLinkStyle(page, item.selector);
  await page.hover(item.selector);
  await page.waitForTimeout(700);
  const hover = await readLinkStyle(page, item.selector);
  await page.mouse.move(1, 1);
  return { normal, hover };
}

function assertContentLinkBaseline(item, state) {
  assert(state.normal, `${item.name} link was not found`, item);
  assert(state.hover, `${item.name} hover state was not readable`, item);
  assert(
    state.normal.opacity === "0.7",
    `${item.name} default mask drifted from the Blog RSS baseline`,
    state.normal,
  );
  assert(
    state.hover.opacity === "1",
    `${item.name} hover mask drifted from the Blog RSS baseline`,
    state.hover,
  );
  assert(
    state.normal.color === state.hover.color,
    `${item.name} should inherit the same user-set text color before and after hover`,
    { normal: state.normal.color, hover: state.hover.color },
  );
  assert(
    String(state.normal.textDecorationLine || "").includes("underline"),
    `${item.name} underline drifted from the Blog RSS baseline`,
    state.normal,
  );
  assert(
    String(state.normal.backgroundImage || "").includes("linear-gradient"),
    `${item.name} ink-rise highlight disappeared`,
    state.normal,
  );
  assert(
    state.hover.backgroundSize !== state.normal.backgroundSize,
    `${item.name} hover highlight animation no longer expands`,
    { normal: state.normal.backgroundSize, hover: state.hover.backgroundSize },
  );
  if (item.icon) {
    assert(
      state.normal.before.content === '""' &&
        state.normal.before.display !== "none" &&
        state.normal.before.backgroundImage !== "none",
      `${item.name} icon link lost its icon slot`,
      state.normal.before,
    );
  }
}

async function assertSharedContentLinkBaseline(page, baseURL) {
  await gotoWithFallback(page, `${baseURL}${BLOG_RSS_LINK_BASELINE.path}?theme=light`, {
    waitUntil: "networkidle",
  });
  const baseline = await readLinkInteraction(page, BLOG_RSS_LINK_BASELINE);
  assertContentLinkBaseline(BLOG_RSS_LINK_BASELINE, baseline);

  for (const item of CONTENT_LINK_STYLE_SAMPLES) {
    await gotoWithFallback(page, `${baseURL}${item.path}?theme=light`, {
      waitUntil: "networkidle",
    });
    const state = await readLinkInteraction(page, item);
    assertContentLinkBaseline(item, state);
  }
}

async function runContracts(baseURL, options = {}) {
  const targets = routeTargets(options);
  const browser = await launchBrowser();
  try {
    const desktop = await browser.newContext({
      viewport: { width: 2048, height: 1220 },
      colorScheme: "light",
    });
    const desktopPage = await desktop.newPage();

    for (const route of targets) {
      await gotoWithFallback(desktopPage, `${baseURL}${route.path}?theme=light`, {
        waitUntil: "networkidle",
      });
      await desktopPage.waitForSelector(`#main-content.${route.pageClass}`, {
        timeout: 10_000,
      });
      await desktopPage.waitForTimeout(200);

      const contract = await readRouteContract(desktopPage, route.pageClass);
      assertClassicRoute(route, contract);
      if (route.kind === "home") assertHomeDesktop(await readHomeContract(desktopPage));

      for (const item of CLASSIC_LINK_ICON_CONTRACT.filter(
        (icon) => icon.route === route.path,
      )) {
        await assertIcon(desktopPage, item);
      }
    }
    await assertSharedContentLinkBaseline(desktopPage, baseURL);
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: "light",
    });
    const mobilePage = await mobile.newPage();
    for (const route of targets) {
      await gotoWithFallback(mobilePage, `${baseURL}${route.path}?theme=light`, {
        waitUntil: "networkidle",
      });
      await mobilePage.waitForSelector(`#main-content.${route.pageClass}`, {
        timeout: 10_000,
      });
      await mobilePage.waitForTimeout(200);
      const contract = await readRouteContract(mobilePage, route.pageClass);
      assertMobileRoute(route, contract);
      if (route.kind === "home") assertMobileHome(await readMobileHomeContract(mobilePage));
    }
    await mobile.close();
  } finally {
    await browser.close();
  }
}

export async function main(options = parseArgs()) {
  if (!options.skipBuild) ensureNextBuild(ROOT, { force: true });
  const port = await findAvailablePort(options.port || process.env.CLASSIC_STYLE_PORT);
  const baseURL = `http://127.0.0.1:${port}`;
  const server = startNextServer({ root: ROOT, port });
  try {
    await waitForHttp(`${baseURL}/`);
    await runContracts(baseURL, options);
    console.log(
      options.homeOnly
        ? "[classic-style-contract] home subset passed"
        : "[classic-style-contract] public classic pages passed",
    );
  } catch (error) {
    console.error(server.getLogs?.() || "");
    throw error;
  } finally {
    server.kill("SIGTERM");
    await sleep(150);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}
