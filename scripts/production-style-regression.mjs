#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureNextBuild,
  findAvailablePort,
  sleep,
  startNextServer,
  waitForHttp,
} from "./_lib/local-next.mjs";
import { launchBrowser } from "./_lib/playwright.mjs";
import { loadProjectEnv } from "./load-project-env.mjs";

const ROOT = process.cwd();
const DEFAULT_PRODUCTION_ORIGIN = "https://jinkunchen.com";
const DEFAULT_STAGING_ORIGIN = "https://staging.jinkunchen.com";
const CLASSIC_MUTED_TEXT_COLOR = "rgba(55, 53, 47, 0.56)";

const ROUTES = [
  {
    path: "/",
    pageClass: "page__index",
    titleIncludes: "Hi there!",
    kind: "home",
    readableColor: CLASSIC_MUTED_TEXT_COLOR,
    linkColor: CLASSIC_MUTED_TEXT_COLOR,
    required: [
      [".home-layout--variant-classicIntro", 1],
      [".home-rich-text--variant-classicBody", 1],
    ],
  },
  {
    path: "/news",
    pageClass: "page__news",
    titleIncludes: "News",
    readableColor: CLASSIC_MUTED_TEXT_COLOR,
    required: [
      [".super-navbar__breadcrumbs .notion-breadcrumb__item", 2],
      [".notion-heading", 1],
      [".news-entry__body", 1],
    ],
    forbidden: [".news-timeline", ".news-card", ".news-list__toolbar"],
  },
  {
    path: "/publications",
    pageClass: "page__publications",
    titleIncludes: "Publications",
    required: [
      [".super-navbar__breadcrumbs .notion-breadcrumb__item", 2],
      [".notion-toggle.publication-toggle", 1],
      [".highlighted-color", 1],
    ],
    forbidden: [".pub-list", ".pub-card", ".pub-list__toolbar", ".pub-filter"],
  },
  {
    path: "/works",
    pageClass: "page__works",
    titleIncludes: "Works",
    readableColor: CLASSIC_MUTED_TEXT_COLOR,
    required: [
      [".super-navbar__breadcrumbs .notion-breadcrumb__item", 2],
      [".notion-toggle.works-toggle", 1],
      [".notion-heading", 1],
    ],
    forbidden: [".works-list", ".work-card", ".works-item__body"],
  },
  {
    path: "/teaching",
    pageClass: "page__teaching",
    titleIncludes: "Teaching",
    readableColor: CLASSIC_MUTED_TEXT_COLOR,
    required: [
      [".super-navbar__breadcrumbs .notion-breadcrumb__item", 2],
      [".notion-bulleted-list .notion-list-item", 1],
    ],
    forbidden: [".teaching-card", ".teaching-table", ".teaching-list__toolbar"],
  },
  {
    path: "/blog",
    pageClass: "page__blog",
    titleIncludes: "Blog",
    required: [
      [".super-navbar__breadcrumbs .notion-breadcrumb__item", 2],
      [".notion-collection.inline", 1],
      [".notion-collection-list__item", 1],
    ],
    forbidden: [".blog-index__toolbar", ".blog-row", ".blog-card"],
  },
  {
    path: "/bio",
    pageClass: "page__mdx-page",
    titleIncludes: "BIO",
    readableColor: CLASSIC_MUTED_TEXT_COLOR,
    required: [
      [".super-navbar__breadcrumbs .notion-breadcrumb__item", 2],
      [".mdx-post__body", 1],
    ],
  },
  {
    path: "/connect",
    pageClass: "page__mdx-page",
    titleIncludes: "Connect",
    readableColor: CLASSIC_MUTED_TEXT_COLOR,
    required: [
      [".super-navbar__breadcrumbs .notion-breadcrumb__item", 2],
      [".mdx-post__body", 1],
    ],
  },
  {
    path: "/chen",
    pageClass: "page__mdx-page",
    titleIncludes: "Yimen Chen",
    readableColor: CLASSIC_MUTED_TEXT_COLOR,
    required: [
      [".super-navbar__breadcrumbs .notion-breadcrumb__item", 2],
      [".mdx-post__body", 1],
    ],
  },
  {
    path: "/notice",
    expectedStatus: 404,
    titleIncludes: "",
    required: [],
  },
];

const DESKTOP = { width: 2048, height: 1220, name: "desktop" };
const MOBILE = { width: 390, height: 844, name: "mobile" };

function parseArgs(argv = process.argv.slice(2)) {
  return {
    skipBuild: argv.includes("--skip-build"),
    candidateAuth:
      argv.includes("--candidate-auth") ||
      ["1", "true", "yes", "on"].includes(
        String(process.env.PRODUCTION_STYLE_CANDIDATE_AUTH || "").toLowerCase(),
      ),
    candidateOrigin:
      argv
        .find((arg) => arg.startsWith("--candidate-origin="))
        ?.slice("--candidate-origin=".length) ||
      process.env.PRODUCTION_STYLE_CANDIDATE_ORIGIN ||
      "",
    productionOrigin:
      argv
        .find((arg) => arg.startsWith("--production-origin="))
        ?.slice("--production-origin=".length) ||
      process.env.PRODUCTION_STYLE_ORIGIN ||
      DEFAULT_PRODUCTION_ORIGIN,
    port: argv.find((arg) => arg.startsWith("--port="))?.slice("--port=".length),
  };
}

function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/+$/, "");
}

function normalizeGithubLogin(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function firstAllowedGithubUser() {
  for (const part of String(process.env.SITE_ADMIN_GITHUB_USERS || "").split(/[,\n]/)) {
    const login = normalizeGithubLogin(part);
    if (login) return login;
  }
  return "";
}

async function createCandidateAuthCookies(candidateOrigin) {
  loadProjectEnv({ cwd: ROOT, override: true, files: [".env"] });
  const secret = String(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim();
  const login = firstAllowedGithubUser();
  assert(secret, "NEXTAUTH_SECRET or AUTH_SECRET is required for candidate auth");
  assert(login, "SITE_ADMIN_GITHUB_USERS must include a login for candidate auth");

  const { encode } = await import("next-auth/jwt");
  const token = await encode({
    secret,
    token: {
      sub: `production-style-${login}`,
      login,
      name: login,
    },
    maxAge: 5 * 60,
  });
  const secure = normalizeOrigin(candidateOrigin).startsWith("https://");
  return ["__Secure-next-auth.session-token", "next-auth.session-token"].map((name) => ({
    name,
    value: token,
    url: candidateOrigin,
    httpOnly: true,
    sameSite: "Lax",
    secure,
  }));
}

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length
    ? `\n${JSON.stringify(details, null, 2)}`
    : "";
  throw new Error(`${message}${suffix}`);
}

function assertClose(actual, expected, tolerance, message, details = {}) {
  assert(
    Number.isFinite(actual) &&
      Number.isFinite(expected) &&
      Math.abs(actual - expected) <= tolerance,
    message,
    { actual, expected, tolerance, ...details },
  );
}

function normalizeStyleValue(value) {
  return String(value || "").trim();
}

function comparableLineHeight(value) {
  const normalized = normalizeStyleValue(value);
  if (normalized === "normal") return normalized;
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? String(Math.round(numeric)) : normalized;
}

function compareTextStyle(local, production, label, options = {}) {
  if (!local || !production) return;
  assert(
    normalizeStyleValue(local.fontSize) === normalizeStyleValue(production.fontSize),
    `${label} font size drifted from production`,
    { local, production },
  );
  assert(
    comparableLineHeight(local.lineHeight) === comparableLineHeight(production.lineHeight),
    `${label} line height drifted from production`,
    { local, production },
  );
  const expectedColor = options.expectedColor || production.color;
  assert(
    normalizeStyleValue(local.color) === normalizeStyleValue(expectedColor),
    options.expectedColor
      ? `${label} text color drifted from the classic muted-text contract`
      : `${label} text color drifted from production`,
    { local, production, expectedColor },
  );
}

function compareLinkStyle(local, production, label, options = {}) {
  if (!local || !production) return;
  const expectedColor = options.expectedColor || production.color;
  assert(
    normalizeStyleValue(local.color) === normalizeStyleValue(expectedColor),
    options.expectedColor
      ? `${label} link color drifted from the classic muted-text contract`
      : `${label} link color drifted from production`,
    { local, production, expectedColor },
  );
  assert(
    normalizeStyleValue(local.textDecorationLine) ===
      normalizeStyleValue(production.textDecorationLine),
    `${label} link underline drifted from production`,
    { local, production },
  );
  assert(
    normalizeStyleValue(local.backgroundColor) ===
      normalizeStyleValue(production.backgroundColor),
    `${label} link highlight background drifted from production`,
    { local, production },
  );
}

function assertRange(actual, min, max, message, details = {}) {
  assert(
    Number.isFinite(actual) && actual >= min && actual <= max,
    message,
    { actual, min, max, ...details },
  );
}

async function gotoWithRetry(page, url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(500);
      return response;
    } catch (error) {
      lastError = error;
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function readSnapshot(page, route, origin, viewportName) {
  const url = `${normalizeOrigin(origin)}${route.path}?theme=light`;
  const response = await gotoWithRetry(page, url);
  const status = response?.status() ?? 0;

  const data = await page.evaluate(
    ({ required, forbidden, pageClass }) => {
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
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          marginBottom: style.marginBottom,
          textDecorationLine: style.textDecorationLine,
        };
      };
      const countOf = (selector) => document.querySelectorAll(selector).length;
      const firstReadable = [
        ".notion-root .mdx-post__body p",
        ".notion-root p",
        ".notion-root li",
        ".notion-root blockquote",
        ".notion-root .mdx-post__body",
      ].reduce((found, selector) => {
        if (found) return found;
        return (
          [...document.querySelectorAll(selector)].find((node) =>
            node.textContent?.trim(),
          ) || null
        );
      }, null);
      const firstLink = document.querySelector(
        [
          ".notion-root .home-section__body a.notion-link.link",
          ".notion-root .mdx-post__body a.notion-link.link",
          ".notion-root .notion-text__content a.notion-link.link",
        ].join(", "),
      );

      return {
        pathname: window.location.pathname,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        mainIds: countOf("#main-content"),
        mainClassName: document.querySelector("#main-content")?.className || "",
        hasPageClass: pageClass
          ? Boolean(document.querySelector(`#main-content.${pageClass}`))
          : false,
        title:
          document.querySelector(".notion-header__title")?.textContent?.trim() || "",
        root: pageClass ? rectOf(`.${pageClass} .notion-root.max-width`) : null,
        header: pageClass
          ? rectOf(`.${pageClass} .notion-header__content.max-width`)
          : null,
        cover: pageClass ? rectOf(`.${pageClass} .notion-header__cover`) : null,
        firstReadableStyle: firstReadable
          ? {
              color: getComputedStyle(firstReadable).color,
              fontSize: getComputedStyle(firstReadable).fontSize,
              lineHeight: getComputedStyle(firstReadable).lineHeight,
            }
          : null,
        firstLinkStyle: firstLink
          ? {
              color: getComputedStyle(firstLink).color,
              backgroundColor: getComputedStyle(firstLink).backgroundColor,
              textDecorationLine: getComputedStyle(firstLink).textDecorationLine,
            }
          : null,
        home: {
          intro: rectOf(".home-layout--variant-classicIntro"),
          introImage: rectOf(
            ".home-layout--variant-classicIntro .home-layout__block--image",
          ),
          introText: rectOf(
            ".home-layout--variant-classicIntro .home-layout__block--markdown",
          ),
          introParagraphStyle: styleOf(
            ".home-layout--variant-classicIntro .home-section__body p",
          ),
          bodyParagraphStyle: styleOf(
            ".home-rich-text--variant-classicBody .home-section__body > p",
          ),
        },
        counts: Object.fromEntries(required.map(([selector]) => [selector, countOf(selector)])),
        forbiddenCounts: Object.fromEntries(
          forbidden.map((selector) => [selector, countOf(selector)]),
        ),
      };
    },
    {
      pageClass: route.pageClass || "",
      required: route.required || [],
      forbidden: route.forbidden || [],
    },
  );

  return { url, status, viewportName, ...data };
}

function compareRoute(route, local, production, viewportName) {
  const expectedStatus = route.expectedStatus ?? production.status;
  assert(
    local.status === expectedStatus,
    `${route.path} returned wrong local status on ${viewportName}`,
    { localStatus: local.status, expectedStatus, productionStatus: production.status },
  );
  if (expectedStatus === 404) return;

  assert(local.mainIds === 1, `${route.path} lost its single main-content root`, {
    mainIds: local.mainIds,
  });
  assert(local.hasPageClass, `${route.path} lost its page class`, {
    expected: route.pageClass,
    mainClassName: local.mainClassName,
  });
  assert(
    local.title.includes(route.titleIncludes),
    `${route.path} title drifted`,
    { title: local.title, expected: route.titleIncludes },
  );

  if (viewportName === "desktop") {
    if (production.root && production.header && production.cover) {
      assertClose(
        local.root?.width ?? 0,
        production.root?.width ?? 0,
        4,
        `${route.path} root width drifted from production`,
      );
      assertClose(
        local.header?.width ?? 0,
        production.header?.width ?? 0,
        4,
        `${route.path} header width drifted from production`,
      );
      assertClose(
        local.cover?.height ?? 0,
        production.cover?.height ?? 0,
        4,
        `${route.path} cover spacer height drifted from production`,
      );
    } else {
      assertRange(
        local.root?.width ?? 0,
        899,
        901,
        `${route.path} root width drifted from the production visual contract`,
      );
      assertRange(
        local.header?.width ?? 0,
        899,
        901,
        `${route.path} header width drifted from the production visual contract`,
      );
      assertRange(
        local.cover?.height ?? 0,
        139,
        141,
        `${route.path} cover spacer height drifted from the production visual contract`,
      );
    }
  }

  assert(
    local.scrollWidth <= local.clientWidth + 1,
    `${route.path} overflows horizontally on ${viewportName}`,
    {
      scrollWidth: local.scrollWidth,
      clientWidth: local.clientWidth,
    },
  );

  compareTextStyle(local.firstReadableStyle, production.firstReadableStyle, route.path, {
    expectedColor: route.readableColor,
  });
  if (!route.readableColor || route.linkColor) {
    compareLinkStyle(local.firstLinkStyle, production.firstLinkStyle, route.path, {
      expectedColor: route.linkColor,
    });
  }

  for (const [selector, min] of route.required || []) {
    const localCount = local.counts[selector] || 0;
    const productionCount = production.counts[selector] || 0;
    const expectedCount = Math.max(min, Math.min(productionCount, min));
    assert(
      localCount >= expectedCount,
      `${route.path} lost production Notion structure: ${selector}`,
      { selector, localCount, productionCount, expectedCount },
    );
  }

  for (const selector of route.forbidden || []) {
    const count = local.forbiddenCounts[selector] || 0;
    assert(count === 0, `${route.path} reintroduced non-production UI selector`, {
      selector,
      count,
    });
  }

  if (route.kind === "home" && viewportName === "desktop") {
    if (production.home.intro && production.home.introImage && production.home.introText) {
      assertClose(
        local.home.intro?.width ?? 0,
        production.home.intro?.width ?? 0,
        6,
        "Homepage intro width drifted from production",
      );
      assertClose(
        local.home.introImage?.width ?? 0,
        production.home.introImage?.width ?? 0,
        4,
        "Homepage image column width drifted from production",
      );
      assertClose(
        local.home.introText?.width ?? 0,
        production.home.introText?.width ?? 0,
        8,
        "Homepage text column width drifted from production",
      );
    } else {
      assertRange(
        local.home.intro?.width ?? 0,
        700,
        716,
        "Homepage intro width drifted from the production visual contract",
      );
      assertRange(
        local.home.introImage?.width ?? 0,
        218,
        222,
        "Homepage image column width drifted from the production visual contract",
      );
      assertRange(
        local.home.introText?.width ?? 0,
        430,
        452,
        "Homepage text column width drifted from the production visual contract",
      );
    }
    compareTextStyle(
      local.home.introParagraphStyle,
      production.home.introParagraphStyle || production.firstReadableStyle,
      "Homepage intro paragraph",
      { expectedColor: route.readableColor },
    );
    compareTextStyle(
      local.home.bodyParagraphStyle,
      production.home.bodyParagraphStyle || production.firstReadableStyle,
      "Homepage body paragraph",
      { expectedColor: route.readableColor },
    );
  }
}

async function compareViewport({
  browser,
  viewport,
  localOrigin,
  productionOrigin,
  candidateAuthCookies = [],
}) {
  const productionContext = await browser.newContext({
    viewport,
    colorScheme: "light",
    userAgent: "jinnkunn.com production-style-regression",
  });
  const localContext = await browser.newContext({
    viewport,
    colorScheme: "light",
    userAgent: "jinnkunn.com production-style-regression",
  });
  if (candidateAuthCookies.length > 0) {
    await localContext.addCookies(candidateAuthCookies);
  }

  try {
    const productionPage = await productionContext.newPage();
    const localPage = await localContext.newPage();
    for (const route of ROUTES) {
      const production = await readSnapshot(
        productionPage,
        route,
        productionOrigin,
        viewport.name,
      );
      const local = await readSnapshot(localPage, route, localOrigin, viewport.name);
      compareRoute(route, local, production, viewport.name);
    }
  } finally {
    await productionContext.close();
    await localContext.close();
  }
}

export async function main(options = parseArgs()) {
  const candidateOrigin = normalizeOrigin(
    options.candidateOrigin ||
      (options.candidateAuth ? DEFAULT_STAGING_ORIGIN : ""),
  );
  let localOrigin = candidateOrigin;
  const productionOrigin = normalizeOrigin(options.productionOrigin);
  let server = null;
  let candidateAuthCookies = [];

  if (candidateOrigin) {
    if (options.candidateAuth) {
      candidateAuthCookies = await createCandidateAuthCookies(candidateOrigin);
    }
  } else {
    if (!options.skipBuild) ensureNextBuild(ROOT, { force: true });
    const port = await findAvailablePort(options.port || process.env.PRODUCTION_STYLE_PORT);
    localOrigin = `http://127.0.0.1:${port}`;
    server = startNextServer({ root: ROOT, port });
  }

  try {
    if (server) await waitForHttp(`${localOrigin}/`);
    const browser = await launchBrowser();
    try {
      await compareViewport({
        browser,
        viewport: DESKTOP,
        localOrigin,
        productionOrigin,
        candidateAuthCookies,
      });
      await compareViewport({
        browser,
        viewport: MOBILE,
        localOrigin,
        productionOrigin,
        candidateAuthCookies,
      });
    } finally {
      await browser.close();
    }
    console.log(
      `[production-style-regression] ${localOrigin} public pages match production contracts (${productionOrigin})`,
    );
  } catch (error) {
    if (server) console.error(server.getLogs?.() || "");
    throw error;
  } finally {
    if (server) {
      server.kill("SIGTERM");
      await sleep(150);
    }
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
