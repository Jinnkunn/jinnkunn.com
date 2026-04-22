import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import matter from "gray-matter";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluate } from "@mdx-js/mdx";
import * as jsxRuntime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

import { DEFAULT_SITE_CONFIG } from "../../lib/shared/default-site-config.mjs";
import { resolveContentSourceKind } from "../../lib/shared/content-source.mjs";
import { normalizeRoutePath, slugify } from "../../lib/shared/route-utils.mjs";
import { escapeHtml } from "../../lib/shared/text-utils.mjs";
import { deepMerge } from "../../lib/shared/object-utils.mjs";
import { ensureDir, readJsonFile, rmDir, writeFile } from "../notion-sync/fs-utils.mjs";
import { buildRouteManifest } from "../notion-sync/sync-artifacts.mjs";
import { extractTitleFromMainHtml, buildSearchIndexFieldsFromMainHtml } from "./html-model.mjs";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "content", "filesystem");
const SOURCE_CONFIG_FILE = path.join(SOURCE_DIR, "site-config.json");
const SOURCE_MANIFEST_FILE = path.join(SOURCE_DIR, "routes-manifest.json");
const SOURCE_PROTECTED_FILE = path.join(SOURCE_DIR, "protected-routes.json");
const SOURCE_RAW_DIR = path.join(SOURCE_DIR, "raw");
const SOURCE_PAGES_DIR = path.join(SOURCE_DIR, "pages");
const OUT_DIR = path.join(ROOT, "content", "generated");
const OUT_RAW_DIR = path.join(OUT_DIR, "raw");

function listFilesRec(rootDir, suffixes) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (suffixes.some((suffix) => ent.name.toLowerCase().endsWith(suffix))) {
        out.push(abs);
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function routePathFromSourceFile(rootDir, filePath) {
  const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
  const noExt = rel.replace(/\.(html|mdx)$/i, "");
  if (noExt === "index") return "/";
  if (noExt.endsWith("/index")) return `/${noExt.slice(0, -"/index".length)}`;
  return `/${noExt}`;
}

function ensureRoutePath(routePath) {
  return normalizeRoutePath(routePath) || "/";
}

function pageIdFromRoute(routePath) {
  return crypto.createHash("sha1").update(ensureRoutePath(routePath)).digest("hex").slice(0, 32);
}

function normalizeManifestItem(value) {
  if (!value || typeof value !== "object") return null;
  const routePath = ensureRoutePath(value.routePath);
  const parentRoutePath = ensureRoutePath(value.parentRoutePath || "");
  const id = String(value.id || "").trim() || pageIdFromRoute(routePath);
  const title = String(value.title || "").trim() || slugify(routePath.replace(/^\/+/, "")) || "Untitled";
  const kind = String(value.kind || "").trim() || "page";
  const parentId = String(value.parentId || "").trim();
  const navGroup = String(value.navGroup || "").trim();
  return {
    id,
    title,
    kind,
    routePath,
    parentId,
    parentRoutePath: parentRoutePath || "/",
    navGroup,
    overridden: Boolean(value.overridden),
  };
}

function loadSourceSiteConfig() {
  const parsed = readJsonFile(SOURCE_CONFIG_FILE) || {};
  const merged = deepMerge(DEFAULT_SITE_CONFIG, parsed);
  const navRaw = parsed?.nav && typeof parsed.nav === "object" ? parsed.nav : {};
  return {
    ...merged,
    nav: {
      top: sortSourceNavItems(normalizeSourceNavGroup(navRaw.top, merged.nav.top)),
      more: sortSourceNavItems(normalizeSourceNavGroup(navRaw.more, merged.nav.more)),
    },
  };
}

function loadSourceProtectedRoutes() {
  const parsed = readJsonFile(SOURCE_PROTECTED_FILE);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeManifestFromSource(siteConfig) {
  const parsed = readJsonFile(SOURCE_MANIFEST_FILE);
  const input = Array.isArray(parsed) ? parsed : [];
  const out = [];
  const byRoute = new Map();
  for (const item of input) {
    const normalized = normalizeManifestItem(item);
    if (!normalized || byRoute.has(normalized.routePath)) continue;
    out.push(normalized);
    byRoute.set(normalized.routePath, normalized);
  }

  for (const rawFile of listFilesRec(SOURCE_RAW_DIR, [".html"])) {
    const routePath = routePathFromSourceFile(SOURCE_RAW_DIR, rawFile);
    if (byRoute.has(routePath)) continue;
    const mainHtml = fs.readFileSync(rawFile, "utf8");
    const title = extractTitleFromMainHtml(mainHtml, "Untitled");
    const parentRoutePath = routePath === "/" ? "/" : ensureRoutePath(path.posix.dirname(routePath));
    const item = {
      id: pageIdFromRoute(routePath),
      title,
      kind: "page",
      routePath,
      parentId: "",
      parentRoutePath,
      navGroup: "",
      overridden: false,
    };
    out.push(item);
    byRoute.set(routePath, item);
  }

  for (const mdxFile of listFilesRec(SOURCE_PAGES_DIR, [".mdx"])) {
    const routePath = routePathFromSourceFile(SOURCE_PAGES_DIR, mdxFile);
    if (byRoute.has(routePath)) continue;
    const raw = fs.readFileSync(mdxFile, "utf8");
    const parsedMdx = matter(raw);
    const parentRoutePath = routePath === "/" ? "/" : ensureRoutePath(path.posix.dirname(routePath));
    const item = {
      id: String(parsedMdx.data.id || "").trim() || pageIdFromRoute(routePath),
      title: String(parsedMdx.data.title || "").trim() || "Untitled",
      kind: String(parsedMdx.data.kind || "").trim() || "page",
      routePath,
      parentId: "",
      parentRoutePath,
      navGroup: "",
      overridden: false,
    };
    out.push(item);
    byRoute.set(routePath, item);
  }

  out.sort((a, b) => a.routePath.localeCompare(b.routePath));
  return out;
}

function normalizeSourceNavItem(raw, fallback, index) {
  const item = raw && typeof raw === "object" ? raw : {};
  return {
    label: String(item.label || fallback?.label || "").trim(),
    href: String(item.href || fallback?.href || "").trim(),
    order: Number.isFinite(Number(item.order)) ? Math.max(0, Math.floor(Number(item.order))) : index,
    enabled: item.enabled === undefined ? true : item.enabled !== false,
  };
}

function normalizeSourceNavGroup(input, fallback) {
  const items = Array.isArray(input) && input.length ? input : fallback;
  return items.map((item, index) => normalizeSourceNavItem(item, fallback?.[index], index));
}

function sortSourceNavItems(items) {
  return [...(Array.isArray(items) ? items : [])]
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.label !== b.label) return String(a.label || "").localeCompare(String(b.label || ""));
      return String(a.href || "").localeCompare(String(b.href || ""));
    })
    .map((item, index) => ({ ...item, order: index }));
}

function buildRuntimeSiteConfig(sourceConfig) {
  return {
    ...sourceConfig,
    nav: {
      top: sortSourceNavItems(sourceConfig.nav.top)
        .filter((item) => item.enabled)
        .map((item) => ({ label: item.label, href: item.href })),
      more: sortSourceNavItems(sourceConfig.nav.more)
        .filter((item) => item.enabled)
        .map((item) => ({ label: item.label, href: item.href })),
    },
  };
}

function styleText(style) {
  return Object.entries(style || {})
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

function headingIdFromChildren(children) {
  const flat = React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      return "";
    })
    .join(" ");
  return slugify(flat) || "section";
}

function createMdxComponents() {
  return {
    h1: ({ children }) => {
      const blockId = `block-${headingIdFromChildren(children)}`;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement("span", { className: "notion-heading__anchor", id: blockId.replace(/^block-/, "") }),
        React.createElement("h1", { id: blockId, className: "notion-heading notion-semantic-string" }, children),
      );
    },
    h2: ({ children }) => {
      const blockId = `block-${headingIdFromChildren(children)}`;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement("span", { className: "notion-heading__anchor", id: blockId.replace(/^block-/, "") }),
        React.createElement("h2", { id: blockId, className: "notion-heading notion-semantic-string" }, children),
      );
    },
    h3: ({ children }) => {
      const blockId = `block-${headingIdFromChildren(children)}`;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement("span", { className: "notion-heading__anchor", id: blockId.replace(/^block-/, "") }),
        React.createElement("h3", { id: blockId, className: "notion-heading notion-semantic-string" }, children),
      );
    },
    p: ({ children }) =>
      React.createElement("p", { className: "notion-text notion-text__content notion-semantic-string" }, children),
    a: ({ href, children }) =>
      React.createElement("a", { href, className: "notion-link link" }, children),
    ul: ({ children }) => React.createElement("ul", { className: "notion-bulleted-list" }, children),
    ol: ({ children }) => React.createElement("ol", { className: "notion-numbered-list" }, children),
    li: ({ children }) => React.createElement("li", { className: "notion-list-item notion-semantic-string" }, children),
    blockquote: ({ children }) =>
      React.createElement("blockquote", { className: "notion-quote notion-semantic-string" }, children),
    hr: () => React.createElement("div", { className: "notion-divider" }),
    pre: ({ children }) =>
      React.createElement("div", { className: "notion-code" }, React.createElement("pre", null, children)),
    code: ({ className, children }) =>
      React.createElement("code", { className: className ? `code ${className}` : "code" }, children),
    img: ({ src, alt }) =>
      React.createElement(
        "div",
        { className: "notion-image align-start page-width" },
        React.createElement(
          "span",
          { style: { display: "contents" } },
          React.createElement("img", {
            src,
            alt: alt || "image",
            loading: "lazy",
            decoding: "async",
            style: { color: "transparent", height: "auto" },
          }),
        ),
      ),
    table: ({ children }) =>
      React.createElement("div", { className: "notion-table__wrapper" }, React.createElement("table", { className: "notion-table" }, children)),
    th: ({ children }) => React.createElement("th", { className: "notion-semantic-string" }, children),
    td: ({ children }) => React.createElement("td", { className: "notion-semantic-string" }, children),
  };
}

function renderMetaProperties(meta) {
  const rows = [];
  const date = String(meta.date || "").trim();
  const author = String(meta.author || "").trim();
  if (date) {
    rows.push(
      `<div class="notion-page__property"><div class="notion-page__property-name">Date</div><div class="notion-property notion-property__date notion-semantic-string"><span class="date">${escapeHtml(
        date,
      )}</span></div></div>`,
    );
  }
  if (author) {
    rows.push(
      `<div class="notion-page__property"><div class="notion-page__property-name">Author</div><div class="notion-property notion-property__person notion-semantic-string"><span>${escapeHtml(
        author,
      )}</span></div></div>`,
    );
  }
  if (!rows.length) return "";
  return `<div class="notion-page__properties">${rows.join("")}<div id="block-root-divider" class="notion-divider"></div></div>`;
}

function buildMainHtmlFromBody(page, bodyHtml, meta = {}) {
  const pageKey = page.routePath === "/" ? "index" : page.routePath.replace(/^\/+/, "").replace(/\//g, "-");
  const parentKey =
    page.parentRoutePath === "/"
      ? "index"
      : (page.parentRoutePath || "/").replace(/^\/+/, "").replace(/\//g, "-") || "index";
  const description = String(meta.description || "").trim();
  const lead = description
    ? `<p class="notion-text notion-text__content notion-semantic-string"><em>${escapeHtml(description)}</em></p>`
    : "";
  const propsHtml = renderMetaProperties(meta);

  return `<main id="page-${escapeHtml(pageKey)}" class="super-content page__${escapeHtml(
    pageKey,
  )} parent-page__${escapeHtml(
    parentKey,
  )}"><div class="notion-header page"><div class="notion-header__cover no-cover no-icon"></div><div class="notion-header__content max-width no-cover no-icon"><div class="notion-header__title-wrapper"><h1 class="notion-header__title">${escapeHtml(
    page.title,
  )}</h1></div></div></div><article id="block-${escapeHtml(
    pageKey,
  )}" class="notion-root max-width has-footer">${propsHtml}${lead}${bodyHtml}</article></main>`;
}

async function renderMdxMainHtml(page, filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const compiled = await evaluate(parsed.content, {
    ...jsxRuntime,
    remarkPlugins: [remarkGfm],
    development: false,
    useDynamicImport: false,
  });
  const Content = compiled.default;
  const components = createMdxComponents();
  const bodyHtml = renderToStaticMarkup(React.createElement(Content, { components }));
  const meta = {
    title: String(parsed.data.title || page.title || "").trim() || page.title,
    description: String(parsed.data.description || "").trim(),
    date: String(parsed.data.date || "").trim(),
    author: String(parsed.data.author || "").trim(),
  };
  const title = meta.title || page.title;
  return {
    mainHtml: buildMainHtmlFromBody({ ...page, title }, bodyHtml, meta),
    meta,
  };
}

function pageSourceForRoute(routePath) {
  const rel = routePath === "/" ? "index" : routePath.replace(/^\/+/, "");
  const rawCandidates = [
    path.join(SOURCE_RAW_DIR, `${rel}.html`),
    path.join(SOURCE_RAW_DIR, rel, "index.html"),
  ];
  for (const candidate of rawCandidates) {
    try {
      if (fs.statSync(candidate).isFile()) return { kind: "raw", filePath: candidate };
    } catch {
      // ignore
    }
  }

  const mdxCandidates = [
    path.join(SOURCE_PAGES_DIR, `${rel}.mdx`),
    path.join(SOURCE_PAGES_DIR, rel, "index.mdx"),
  ];
  for (const candidate of mdxCandidates) {
    try {
      if (fs.statSync(candidate).isFile()) return { kind: "mdx", filePath: candidate };
    } catch {
      // ignore
    }
  }

  return null;
}

export async function syncFilesystemContent() {
  const sourceSiteConfig = loadSourceSiteConfig();
  const siteConfig = buildRuntimeSiteConfig(sourceSiteConfig);
  const protectedRoutes = loadSourceProtectedRoutes();
  const routeManifest = normalizeManifestFromSource(siteConfig);
  const routeOverrides = new Map(
    Object.entries(siteConfig?.content?.routeOverrides || {})
      .map(([pageId, routePath]) => [String(pageId || "").trim(), ensureRoutePath(routePath)])
      .filter(([pageId, routePath]) => pageId && routePath),
  );

  rmDir(OUT_RAW_DIR);
  ensureDir(OUT_RAW_DIR);

  const searchIndex = [];
  for (const page of routeManifest) {
    const src = pageSourceForRoute(page.routePath);
    if (!src) {
      throw new Error(`Missing filesystem source page for route '${page.routePath}'`);
    }

    let mainHtml = "";
    if (src.kind === "raw") {
      mainHtml = fs.readFileSync(src.filePath, "utf8");
    } else {
      const rendered = await renderMdxMainHtml(page, src.filePath);
      mainHtml = rendered.mainHtml;
      if (!page.title || page.title === "Untitled") page.title = rendered.meta.title || page.title;
    }

    const fields = buildSearchIndexFieldsFromMainHtml(mainHtml, 8000);
    searchIndex.push({
      id: page.id,
      title: page.title,
      kind: page.kind,
      routePath: page.routePath,
      headings: fields.headings,
      text: fields.text,
    });

    const rel = page.routePath === "/" ? "index.html" : `${page.routePath.replace(/^\/+/, "")}.html`;
    writeFile(path.join(OUT_RAW_DIR, rel), `${String(mainHtml || "").trim()}\n`);
  }

  const routes = Object.fromEntries(routeManifest.map((page) => [page.routePath, page.id]));
  const homePage = routeManifest.find((page) => page.routePath === "/") || null;
  const normalizedRouteManifest = buildRouteManifest(routeManifest, siteConfig, routeOverrides);
  const syncMeta = {
    syncedAt: new Date().toISOString(),
    contentSource: resolveContentSourceKind({ fallback: "filesystem" }),
    homePageId: homePage?.id || "",
    homeTitle: homePage?.title || "",
    pages: routeManifest.length,
    routes: routeManifest.length,
    routeOverrides: routeOverrides.size,
    protectedRules: protectedRoutes.length,
  };

  writeFile(path.join(OUT_DIR, "site-config.json"), JSON.stringify(siteConfig, null, 2) + "\n");
  writeFile(path.join(OUT_DIR, "protected-routes.json"), JSON.stringify(protectedRoutes, null, 2) + "\n");
  writeFile(path.join(OUT_DIR, "routes.json"), JSON.stringify(routes, null, 2) + "\n");
  writeFile(
    path.join(OUT_DIR, "routes-manifest.json"),
    JSON.stringify(normalizedRouteManifest, null, 2) + "\n",
  );
  writeFile(path.join(OUT_DIR, "search-index.json"), JSON.stringify(searchIndex) + "\n");
  writeFile(path.join(OUT_DIR, "sync-meta.json"), JSON.stringify(syncMeta, null, 2) + "\n");
}
