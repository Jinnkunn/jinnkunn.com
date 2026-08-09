import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import matter from "gray-matter";

import { DEFAULT_SITE_CONFIG } from "../../lib/shared/default-site-config.mjs";
import { canonicalizeRoutePath, normalizeRoutePath } from "../../lib/shared/route-utils.mjs";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: process.env,
      ...opts,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function ensureGeneratedStubs() {
  const dir = path.join(process.cwd(), "content", "generated");
  fs.mkdirSync(dir, { recursive: true });

  const writeIfMissing = (name, obj) => {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).isFile()) return;
    } catch {
      // ignore
    }
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
  };

  // These files are imported at build time (edge / proxy) so CI must have *something*
  // even when NOTION_* is not configured.
  writeIfMissing("routes.json", {});
  writeIfMissing("routes-manifest.json", []);
  writeIfMissing("search-index.json", []);
  writeIfMissing("content-routes.json", []);
  writeIfMissing("protected-routes.json", []);
  writeIfMissing("classic-css-assets.json", { source: "", stylesheets: [] });
  writeIfMissing("site-config.json", DEFAULT_SITE_CONFIG);
  writeIfMissing("sync-meta.json", { syncedAt: "1970-01-01T00:00:00.000Z" });
}

function sha1Hex(input) {
  return crypto.createHash("sha1").update(input, "utf8").digest("hex");
}

function gitBlobSha(input) {
  const header = `blob ${Buffer.byteLength(input, "utf8")}\0`;
  return crypto.createHash("sha1").update(header, "utf8").update(input, "utf8").digest("hex");
}

function writeIfChanged(file, obj) {
  const next = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    if (fs.readFileSync(file, "utf8") === next) return;
  } catch {
    // ignore
  }
  fs.writeFileSync(file, next, "utf8");
}

function writeComponentSourceManifest() {
  const root = process.cwd();
  const componentsDir = path.join(root, "content", "components");
  const generatedDir = path.join(root, "content", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  const components = {};
  let names = [];
  try {
    names = fs
      .readdirSync(componentsDir)
      .filter((name) => name.endsWith(".mdx"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    names = [];
  }
  for (const filename of names) {
    const name = filename.replace(/\.mdx$/, "");
    const relPath = `content/components/${filename}`;
    const content = fs.readFileSync(path.join(componentsDir, filename), "utf8");
    components[name] = {
      path: relPath,
      sha: gitBlobSha(content),
      contentSha: sha1Hex(content),
      size: Buffer.byteLength(content, "utf8"),
    };
  }
  writeIfChanged(path.join(generatedDir, "component-sources.json"), {
    components,
  });
}

// --- content indexes -------------------------------------------------------
// `content/**/*.mdx` never reaches the Cloudflare Worker: wrangler only bundles
// `content/**/*.json` as Data modules. Anything that needs post/page facts at
// runtime (sitemap, search) therefore has to read a JSON artifact that is
// *statically imported*, not the MDX files. These builders produce that
// artifact at build time from the same frontmatter contract as
// `lib/posts/meta.ts` / `lib/pages/meta.ts`.

const MDX_CONTENT_SOURCES = [
  { kind: "page", dir: "pages", recursive: true, routeFor: (slug) => `/${slug}` },
  { kind: "post", dir: "posts", recursive: false, routeFor: (slug) => `/blog/${slug}` },
];

// `lib/search-index.ts` re-caps at 18 headings / 520 heading chars / 2200 body
// chars on read, so anything past that is bundle weight the Worker throws away.
const MAX_HEADINGS = 18;
const MAX_HEADING_CHARS = 420;
const MAX_TEXT_CHARS = 2200;

function listMdxRelPaths(rootDir, recursive) {
  const out = [];
  const stack = [{ dir: rootDir, prefix: "" }];

  while (stack.length) {
    const { dir, prefix } = stack.pop();
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (recursive) stack.push({ dir: path.join(dir, ent.name), prefix: rel });
        continue;
      }
      if (ent.isFile() && /\.mdx?$/.test(ent.name)) out.push(rel);
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function stripMarkdownInline(line) {
  return String(line || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capSearchText(lines) {
  const out = [];
  const seen = new Set();
  let total = 0;
  for (const line of lines) {
    if (!line || line.length < 2) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    total += line.length + 1;
    if (total >= MAX_TEXT_CHARS) break;
  }
  return out.join("\n").slice(0, MAX_TEXT_CHARS).trim();
}

function capHeadings(lines) {
  const out = [];
  const seen = new Set();
  let chars = 0;
  for (const line of lines) {
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    chars += line.length + 1;
    if (out.length >= MAX_HEADINGS) break;
    if (chars >= MAX_HEADING_CHARS) break;
  }
  return out;
}

// Attributes that are plumbing rather than prose. Everything else is rendered
// to the visitor somewhere, so it belongs in the index.
// `lang` is plumbing too: the CJK runs on /, /chen and /yiling carry
// `lang="zh-Hans"` for WCAG 3.1.2, and without this the tag values would be
// indexed as prose ("zh-Hans zh-Hans zh-Latn-pinyin ...").
const NON_TEXT_ATTR = /^(?:class|className|style|id|key|href|src|width|height|lang)$|^(?:data|aria)-|(?:[Uu]rl|[Ii]d|Style)$/;

function isUrlish(value) {
  return /^(?:https?:|mailto:|\/|#|data:)/.test(value.trim());
}

function collectJsonStrings(value, out) {
  if (typeof value === "string") {
    const s = value.trim();
    if (s && !isUrlish(s)) out.push(s);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonStrings(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectJsonStrings(item, out);
  }
}

/**
 * Pull the display text that only exists as JSX props. `<PublicationsEntry
 * data='{"title":…}' />` and `<WorksEntry role="…" period="…">` render real
 * page copy, but tag-stripping deletes it — which is how /news, /publications
 * and /works ended up with an empty search body.
 */
function extractJsxAttrText(rawLine) {
  const out = [];
  for (const tag of String(rawLine || "").matchAll(/<[A-Za-z][^>]*>/g)) {
    for (const attr of tag[0].matchAll(/([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const name = attr[1];
      if (NON_TEXT_ATTR.test(name)) continue;
      const value = (attr[2] ?? attr[3] ?? "").trim();
      if (!value || isUrlish(value)) continue;
      if (/^[[{]/.test(value)) {
        try {
          collectJsonStrings(JSON.parse(value), out);
          continue;
        } catch {
          // Not JSON after all; fall through and treat it as plain text.
        }
      }
      out.push(value);
    }
  }
  return stripMarkdownInline(out.join(" "));
}

function collectSearchLines(body) {
  const headings = [];
  const bodyLines = [];
  let inFence = false;

  for (const rawLine of String(body || "").split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Thematic breaks (`---`, `***`) carry no search value.
    if (/^\s{0,3}([-*_])\s*\1\s*\1[-*_\s]*$/.test(rawLine)) continue;

    const heading = rawLine.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const text = stripMarkdownInline(heading[1]);
      if (text) headings.push(text);
      continue;
    }

    if (rawLine.includes("<")) {
      const attrText = extractJsxAttrText(rawLine);
      if (attrText) bodyLines.push(attrText);
    }
    const text = stripMarkdownInline(rawLine.replace(/^\s{0,3}(?:[>*+-]|\d+\.)\s+/, ""));
    if (text) bodyLines.push(text);
  }

  return { headings, bodyLines };
}

export function extractSearchFieldsFromMdx(body) {
  const { headings, bodyLines } = collectSearchLines(body);
  return { headings: capHeadings(headings), text: capSearchText(bodyLines) };
}

/**
 * `<WorksBlock />` on `content/pages/works.mdx` renders
 * `content/components/works.mdx`. Following the embed is what keeps the
 * publication, news and works rows searchable — the page files themselves are
 * little more than a wrapper.
 */
function resolveEmbeddedComponents(root, body) {
  const names = new Set();
  for (const match of String(body || "").matchAll(/<([A-Z][A-Za-z0-9]*)Block\b/g)) {
    names.add(match[1].toLowerCase());
  }

  const out = [];
  for (const name of Array.from(names).sort((a, b) => a.localeCompare(b))) {
    const file = path.join(root, "content", "components", `${name}.mdx`);
    try {
      if (!fs.statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    out.push({ name, file });
  }
  return out;
}

function frontmatterDateIso(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Mirrors the required-field contract of `lib/posts/meta.ts` and
 * `lib/pages/meta.ts`; `tests/search/content-index-generator.test.mjs` asserts
 * the two stay in agreement for every file in the repo.
 */
function parseContentEntry({ root, kind, slug, routePath, source, mtimeMs }) {
  const parsed = matter(source);
  const data = parsed.data && typeof parsed.data === "object" ? parsed.data : {};

  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) throw new Error(`${kind}: frontmatter.title is required (${slug})`);

  const collected = collectSearchLines(parsed.content);
  let contentMtimeMs = Number.isFinite(mtimeMs) ? mtimeMs : 0;
  for (const embed of resolveEmbeddedComponents(root, parsed.content)) {
    let embedded = null;
    try {
      embedded = collectSearchLines(matter(fs.readFileSync(embed.file, "utf8")).content);
      contentMtimeMs = Math.max(contentMtimeMs, fs.statSync(embed.file).mtimeMs);
    } catch (err) {
      throw new Error(`${kind}: <${embed.name}Block /> source is unreadable (${err?.message || err})`);
    }
    collected.headings.push(...embedded.headings);
    collected.bodyLines.push(...embedded.bodyLines);
  }

  let lastmod = null;
  if (kind === "post") {
    if (data.date === undefined || data.date === null || data.date === "") {
      throw new Error(`post: frontmatter.date is required (${slug})`);
    }
    lastmod = frontmatterDateIso(data.date);
    if (!lastmod) throw new Error(`post: frontmatter.date is unparsable (${slug})`);
  } else if (data.updated !== undefined && data.updated !== null && data.updated !== "") {
    lastmod = frontmatterDateIso(data.updated);
    if (!lastmod) throw new Error(`page: frontmatter.updated is unparsable (${slug})`);
  }

  // An embedded component is page content: editing `content/components/news.mdx`
  // changes what /news renders, so it has to move the page's lastmod too.
  if (!lastmod && contentMtimeMs > 0) {
    lastmod = new Date(contentMtimeMs).toISOString();
  }

  return {
    routePath,
    kind,
    slug,
    title,
    draft: Boolean(data.draft),
    lastmod,
    headings: capHeadings(collected.headings),
    text: capSearchText(collected.bodyLines),
  };
}

/**
 * Password-protected routes are already dropped from the sitemap
 * (`isProtectedExcluded`); leaving their body text in the public search index
 * hands out the content the password is supposed to gate. Mirrors
 * `findProtectedMatch` (lib/routes/strategy.ts) for path-keyed rules —
 * pageId-keyed rules can't apply here because MDX carries no page id.
 */
function readProtectedRoutePrefixes(root) {
  const candidates = ["local", "filesystem", "generated"].map((dir) =>
    path.join(root, "content", dir, "protected-routes.json"),
  );

  let rules = null;
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) {
        rules = parsed;
        break;
      }
    } catch {
      // try the next root
    }
  }
  if (!rules) return [];

  const out = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const mode = String(rule.mode || "");
    if (mode !== "exact" && mode !== "prefix") continue;
    if (!String(rule.token || "").trim()) continue;
    const prefix = normalizeRoutePath(String(rule.path || ""));
    if (!prefix || prefix === "/") continue;
    out.push(prefix);
  }
  return out;
}

function isProtectedRoute(routePath, prefixes) {
  return prefixes.some((prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`));
}

function readHomeContentEntry(root) {
  const filePath = path.join(root, "content", "home.json");
  let home = null;
  let mtimeMs = 0;
  try {
    home = JSON.parse(fs.readFileSync(filePath, "utf8"));
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  if (!home || typeof home !== "object") return null;

  const title = typeof home.title === "string" ? home.title.trim() : "";
  const { headings, text } = extractSearchFieldsFromMdx(home.bodyMdx);
  if (!title && !text) return null;

  return {
    routePath: "/",
    kind: "page",
    slug: "",
    title: title || "Home",
    draft: false,
    lastmod: mtimeMs > 0 ? new Date(mtimeMs).toISOString() : null,
    headings,
    text,
  };
}

/**
 * Walk `content/pages` + `content/posts` and build the build-time content
 * index. Returns the warnings so the caller can decide how loud to be — a
 * silently empty index is what collapsed the production sitemap to 4 URLs.
 */
export function buildContentIndexes(root = process.cwd()) {
  const entries = [];
  const warnings = [];
  const seen = new Set();
  let fileCount = 0;

  for (const source of MDX_CONTENT_SOURCES) {
    const rootDir = path.join(root, "content", source.dir);
    for (const rel of listMdxRelPaths(rootDir, source.recursive)) {
      const slug = rel.replace(/\.mdx?$/, "");
      if (!slug) continue;
      fileCount += 1;

      const filePath = path.join(rootDir, rel);
      let raw = "";
      let mtimeMs = 0;
      try {
        raw = fs.readFileSync(filePath, "utf8");
        mtimeMs = fs.statSync(filePath).mtimeMs;
      } catch (err) {
        warnings.push(`content/${source.dir}/${rel}: unreadable (${err?.message || err})`);
        continue;
      }

      const routePath = canonicalizeRoutePath(source.routeFor(slug));
      if (!routePath) {
        warnings.push(`content/${source.dir}/${rel}: slug does not map to a route`);
        continue;
      }
      if (seen.has(routePath)) {
        warnings.push(`content/${source.dir}/${rel}: duplicate route ${routePath}`);
        continue;
      }

      try {
        entries.push(
          parseContentEntry({ root, kind: source.kind, slug, routePath, source: raw, mtimeMs }),
        );
        seen.add(routePath);
      } catch (err) {
        warnings.push(`content/${source.dir}/${rel}: ${err?.message || err}`);
      }
    }
  }

  // The home route has no MDX file — it renders from `content/home.json` — but
  // dropping it would make the site's most-linked page unsearchable.
  const homeEntry = readHomeContentEntry(root);
  if (homeEntry && !seen.has(homeEntry.routePath)) {
    entries.push(homeEntry);
    seen.add(homeEntry.routePath);
  }

  entries.sort((a, b) => a.routePath.localeCompare(b.routePath));

  const protectedPrefixes = readProtectedRoutePrefixes(root);

  // A password-gated route must not be advertised anywhere public. The search
  // index already filtered these out; the sitemap consumes `routes`, so the flag
  // has to travel with the route or crawlers get pointed at the password gate.
  const routes = entries.map(({ routePath, kind, slug, title, draft, lastmod }) => ({
    routePath,
    kind,
    slug,
    title,
    draft,
    protected: isProtectedRoute(routePath, protectedPrefixes),
    lastmod,
  }));

  const searchIndex = entries
    .filter((entry) => !entry.draft && !isProtectedRoute(entry.routePath, protectedPrefixes))
    .map((entry) => {
      const item = {
        id: sha1Hex(entry.routePath).slice(0, 32),
        title: entry.title,
        kind: entry.kind,
        routePath: entry.routePath,
        text: entry.text,
      };
      if (entry.headings.length) item.headings = entry.headings;
      return item;
    });

  return { routes, searchIndex, warnings, fileCount };
}

function writeContentIndexes({ writeSearchIndex = true } = {}) {
  const root = process.cwd();
  const generatedDir = path.join(root, "content", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  const { routes, searchIndex, warnings, fileCount } = buildContentIndexes(root);

  for (const warning of warnings) {
    console.warn(`[prebuild] content index: ${warning}`);
  }
  if (fileCount > 0 && routes.length === 0) {
    throw new Error(
      `[prebuild] content index produced 0 routes from ${fileCount} MDX files; ` +
        "refusing to ship an empty sitemap/search index",
    );
  }
  if (fileCount === 0) {
    console.warn("[prebuild] content index: no MDX found under content/pages or content/posts");
  }

  writeIfChanged(path.join(generatedDir, "content-routes.json"), routes);
  if (writeSearchIndex) {
    writeIfChanged(path.join(generatedDir, "search-index.json"), searchIndex);
  }

  const published = routes.filter((r) => !r.draft).length;
  console.log(
    `[prebuild] content index: ${routes.length} routes (${published} published) from ${fileCount} files` +
      `${warnings.length ? `, ${warnings.length} skipped` : ""}`,
  );
}

function resolveMode() {
  // Explicit env always wins. When unset, infer `db` from
  // SITE_ADMIN_STORAGE=db so users only need one knob to flip the whole
  // content pipeline; everything else falls through to the legacy `stubs`
  // default.
  const explicit = String(process.env.CONTENT_SYNC_MODE || "").trim().toLowerCase();
  if (explicit === "notion" || explicit === "stubs" || explicit === "db") {
    return explicit;
  }
  const storage = String(process.env.SITE_ADMIN_STORAGE || "").trim().toLowerCase();
  if (storage === "db") return "db";
  return "stubs";
}

async function dumpFromD1() {
  // Pass through the deploy env + location so the same prebuild can target
  // dev / staging / production D1 instances. Defaults (no env, --remote)
  // match `npm run build` from a developer machine.
  const args = ["scripts/content/dump-content-from-db.mjs"];
  const envName = String(process.env.SITE_ADMIN_DB_ENV || "").trim();
  if (envName) args.push(`--env=${envName}`);
  const location = String(process.env.SITE_ADMIN_DB_LOCATION || "remote").trim().toLowerCase();
  if (location === "local") args.push("--local");
  else args.push("--remote");
  args.push("--quiet");
  await run("node", args);
}

export async function main() {
  const skipSync = process.env.SKIP_SYNC === "1" || process.env.SKIP_SYNC === "true";
  if (skipSync) {
    // The content indexes are derived from files already in the tree, so they
    // must still be refreshed even when the remote sync is skipped.
    ensureGeneratedStubs();
    writeContentIndexes();
    console.log("[prebuild] SKIP_SYNC enabled; skipping content sync");
    return;
  }

  const mode = resolveMode();

  if (mode === "notion") {
    const hasNotion =
      Boolean(process.env.NOTION_TOKEN) && Boolean(process.env.NOTION_SITE_ADMIN_PAGE_ID);
    if (!hasNotion) {
      throw new Error(
        "CONTENT_SYNC_MODE=notion requires NOTION_TOKEN and NOTION_SITE_ADMIN_PAGE_ID",
      );
    }
    console.log("[prebuild] CONTENT_SYNC_MODE=notion; running Notion sync...");
    await run("npm", ["run", "sync:notion"]);
    ensureGeneratedStubs();
    // Notion sync indexes rendered Notion pages (including raw-HTML routes),
    // which is a superset of the MDX tree; leave its search index alone.
    writeContentIndexes({ writeSearchIndex: false });
    writeComponentSourceManifest();
    return;
  }

  if (mode === "db") {
    console.log("[prebuild] CONTENT_SYNC_MODE=db; dumping content from D1...");
    await dumpFromD1();
    ensureGeneratedStubs();
    writeContentIndexes();
    writeComponentSourceManifest();
    return;
  }

  ensureGeneratedStubs();
  writeContentIndexes();
  writeComponentSourceManifest();
  console.log("[prebuild] CONTENT_SYNC_MODE=stubs; ensured generated stubs.");
}

// Only self-run when invoked as a script so tests can import the generators.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  });
}
