import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_ROOT = path.join(process.cwd(), "output", "quality-prod");
const DEFAULT_ORIGIN = "https://jinkunchen.com";

function isoStampForPath(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function normalizeOrigin(origin) {
  const raw = String(origin || "").trim();
  if (!raw) return DEFAULT_ORIGIN;
  const clean = raw.replace(/\/+$/g, "");
  if (/^https?:\/\//i.test(clean)) return clean;
  return `https://${clean}`;
}

function normalizePath(pathname) {
  const p = String(pathname || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.replace(/\/+$/g, "") || "/";
}

function canonicalizeExpectedPath(pathname) {
  const p = normalizePath(pathname);
  if (p === "/blog/list") return "/blog";
  if (p.startsWith("/blog/list/")) return `/blog/${p.slice("/blog/list/".length)}`;
  if (p === "/list") return "/blog";
  if (p.startsWith("/list/")) return `/blog/${p.slice("/list/".length)}`;
  return p;
}

function parseLocTags(xmlText) {
  const out = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let match;
  while ((match = re.exec(String(xmlText || "")))) {
    const raw = String(match[1] || "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

function extractAttr(tagText, attrName) {
  const re = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tagText || "").match(re);
  if (!match) return "";
  return String(match[1] || match[2] || match[3] || "").trim();
}

function extractCanonicalHref(htmlText) {
  const html = String(htmlText || "");
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = extractAttr(tag, "rel").toLowerCase();
    if (!rel || !rel.split(/\s+/g).includes("canonical")) continue;
    const href = extractAttr(tag, "href");
    if (href) return href;
  }
  return "";
}

function extractInternalLinks(htmlText, origin) {
  const out = new Set();
  const html = String(htmlText || "");
  const tagRe = /<a\b[^>]*>/gi;
  let match;
  while ((match = tagRe.exec(html))) {
    const href = extractAttr(match[0], "href");
    if (!href) continue;
    if (href.startsWith("#")) continue;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;

    let url;
    try {
      url = new URL(href, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;

    const p = normalizePath(url.pathname);
    if (
      p.startsWith("/_next") ||
      p.startsWith("/cdn-cgi") ||
      p.startsWith("/api") ||
      p.startsWith("/site-admin") ||
      p.startsWith("/auth")
    ) {
      continue;
    }
    out.add(p);
  }
  return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
}

async function fetchWithTimeout(url, timeoutMs, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      ...opts,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs) {
  const res = await fetchWithTimeout(url, timeoutMs);
  const text = await res.text().catch(() => "");
  return { res, text };
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

async function main() {
  const origin = normalizeOrigin(process.env.QUALITY_PROD_ORIGIN || DEFAULT_ORIGIN);
  const timeoutMs = Math.max(2000, Number(process.env.QUALITY_PROD_TIMEOUT_MS || 15000));
  const maxPages = Math.max(5, Number(process.env.QUALITY_PROD_MAX_PAGES || 120));
  const maxLinksPerPage = Math.max(5, Number(process.env.QUALITY_PROD_MAX_LINKS_PER_PAGE || 40));
  const concurrency = Math.max(1, Math.min(16, Number(process.env.QUALITY_PROD_CONCURRENCY || 6)));

  const stamp = isoStampForPath();
  const outDir = path.join(OUT_ROOT, stamp);
  await mkdir(outDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    origin,
    config: {
      timeoutMs,
      maxPages,
      maxLinksPerPage,
      concurrency,
    },
    sitemaps: {
      index: "",
      sections: [],
      discoveredPaths: 0,
      sampledPaths: 0,
    },
    summary: {
      issues: 0,
      warnings: 0,
      brokenLinks: 0,
      canonicalMismatches: 0,
      missingCanonical: 0,
      sitemapViolations: 0,
    },
    issues: [],
    warnings: [],
  };

  const indexUrl = `${origin}/sitemap.xml`;
  const indexFetched = await fetchText(indexUrl, timeoutMs);
  report.sitemaps.index = indexUrl;
  if (!indexFetched.res.ok) {
    report.issues.push({
      type: "sitemap-index-fetch",
      url: indexUrl,
      status: indexFetched.res.status,
    });
  }

  const sectionLocs = parseLocTags(indexFetched.text);
  if (sectionLocs.length === 0) {
    report.issues.push({
      type: "sitemap-index-empty",
      url: indexUrl,
    });
  }

  const sitemapPaths = new Set();

  for (const loc of sectionLocs) {
    let sectionUrl;
    try {
      sectionUrl = new URL(loc, origin).toString();
    } catch {
      report.issues.push({ type: "sitemap-section-invalid-loc", loc });
      continue;
    }

    const fetched = await fetchText(sectionUrl, timeoutMs);
    const pathName = normalizePath(new URL(sectionUrl).pathname);
    const sectionRecord = {
      url: sectionUrl,
      path: pathName,
      status: fetched.res.status,
      count: 0,
    };
    report.sitemaps.sections.push(sectionRecord);

    if (!fetched.res.ok) {
      report.issues.push({
        type: "sitemap-section-fetch",
        url: sectionUrl,
        status: fetched.res.status,
      });
      continue;
    }

    const pageLocs = parseLocTags(fetched.text);
    sectionRecord.count = pageLocs.length;
    if (pageLocs.length === 0) {
      report.warnings.push({
        type: "sitemap-section-empty",
        url: sectionUrl,
      });
      continue;
    }

    for (const pageLoc of pageLocs) {
      try {
        const u = new URL(pageLoc, origin);
        if (u.origin !== origin) {
          report.issues.push({
            type: "sitemap-cross-origin-url",
            loc: pageLoc,
          });
          continue;
        }
        const p = canonicalizeExpectedPath(u.pathname);
        if (
          p.startsWith("/api") ||
          p.startsWith("/site-admin") ||
          p.startsWith("/auth")
        ) {
          report.issues.push({
            type: "sitemap-private-path",
            path: p,
          });
          continue;
        }
        sitemapPaths.add(p);
      } catch {
        report.issues.push({
          type: "sitemap-url-invalid",
          loc: pageLoc,
        });
      }
    }
  }

  const sitemapPathList = Array.from(sitemapPaths.values()).sort((a, b) => a.localeCompare(b));
  report.sitemaps.discoveredPaths = sitemapPathList.length;
  const sampledPaths = sitemapPathList.slice(0, maxPages);
  report.sitemaps.sampledPaths = sampledPaths.length;

  const discoveredInternalLinks = new Set();

  await mapLimit(sampledPaths, concurrency, async (routePath) => {
    const url = `${origin}${routePath}`;
    const fetched = await fetchText(url, timeoutMs);
    if (!fetched.res.ok) {
      report.issues.push({
        type: "page-fetch",
        path: routePath,
        status: fetched.res.status,
      });
      return;
    }

    const canonicalHref = extractCanonicalHref(fetched.text);
    if (!canonicalHref) {
      report.issues.push({
        type: "canonical-missing",
        path: routePath,
      });
      return;
    }

    let canonicalPath = "";
    try {
      canonicalPath = canonicalizeExpectedPath(new URL(canonicalHref, origin).pathname);
    } catch {
      report.issues.push({
        type: "canonical-invalid",
        path: routePath,
        canonicalHref,
      });
      return;
    }

    const expected = canonicalizeExpectedPath(routePath);
    if (canonicalPath !== expected) {
      report.issues.push({
        type: "canonical-mismatch",
        path: routePath,
        canonicalPath,
        expected,
      });
    }

    const links = extractInternalLinks(fetched.text, origin).slice(0, maxLinksPerPage);
    for (const p of links) discoveredInternalLinks.add(canonicalizeExpectedPath(p));
  });

  const linkCache = new Map();
  const linksToCheck = Array.from(discoveredInternalLinks.values()).sort((a, b) => a.localeCompare(b));

  await mapLimit(linksToCheck, concurrency, async (routePath) => {
    if (linkCache.has(routePath)) return linkCache.get(routePath);
    const url = `${origin}${routePath}`;
    const fetched = await fetchWithTimeout(url, timeoutMs);
    const finalPath = canonicalizeExpectedPath(new URL(fetched.url, origin).pathname);
    const result = {
      path: routePath,
      status: fetched.status,
      finalPath,
      ok: fetched.status < 400,
    };
    linkCache.set(routePath, result);
    if (!result.ok) {
      report.issues.push({
        type: "broken-internal-link",
        path: routePath,
        status: fetched.status,
      });
      return result;
    }

    if (
      finalPath.startsWith("/auth") ||
      finalPath.startsWith("/site-admin/login")
    ) {
      report.warnings.push({
        type: "internal-link-redirects-to-auth",
        path: routePath,
        finalPath,
        status: fetched.status,
      });
    }
    return result;
  });

  report.summary.issues = report.issues.length;
  report.summary.warnings = report.warnings.length;
  report.summary.brokenLinks = report.issues.filter((i) => i.type === "broken-internal-link").length;
  report.summary.canonicalMismatches = report.issues.filter((i) => i.type === "canonical-mismatch").length;
  report.summary.missingCanonical = report.issues.filter((i) => i.type === "canonical-missing").length;
  report.summary.sitemapViolations = report.issues.filter((i) => String(i.type || "").startsWith("sitemap-")).length;

  const resultFile = path.join(outDir, "report.json");
  const latestFile = path.join(OUT_ROOT, "latest.json");
  await writeFile(resultFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Report: ${resultFile}`);
  console.log(`Latest: ${latestFile}`);
  console.log(
    `[quality-prod] sampled=${sampledPaths.length} links=${linksToCheck.length} issues=${report.summary.issues} warnings=${report.summary.warnings}`,
  );

  if (report.summary.issues > 0) {
    for (const issue of report.issues.slice(0, 40)) {
      console.log(`ISSUE ${issue.type}: ${JSON.stringify(issue)}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
