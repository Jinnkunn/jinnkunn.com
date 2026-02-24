import "server-only";

import fs from "node:fs";
import path from "node:path";

function sanitizeRelPath(relPath: string): string {
  const rel = String(relPath || "").trim().replace(/^\/+/, "");
  if (!rel) return "";
  // Prevent traversal; these helpers are only for `content/**` lookups.
  if (rel.includes("..")) return "";
  return rel;
}

export function getContentFileCandidates(relPath: string): string[] {
  const rel = sanitizeRelPath(relPath);
  if (!rel) return [];
  return [path.join(process.cwd(), "content", "generated", rel)];
}

export function findFirstExistingFile(candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export function findContentFile(relPath: string): string | null {
  return findFirstExistingFile(getContentFileCandidates(relPath));
}

export function readJsonFile(filePath: string): unknown | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listHtmlFilesRecSync(rootDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length) {
    const dir = stack.pop()!;
    let ents: fs.Dirent[] = [];
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
      if (ent.isFile() && ent.name.endsWith(".html")) out.push(abs);
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export type RawHtmlFileInfo = {
  relPath: string;
  filePath: string;
  mtimeMs: number;
};

function isDirSync(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function getRawHtmlRoots(): string[] {
  return [path.join(process.cwd(), "content", "generated", "raw")];
}

function normalizeRawHtmlRoutePath(routePath: string): string {
  let p = String(routePath ?? "").trim();
  // Drop any leading/trailing slashes so `path.join(root, p + ".html")` can't ignore root.
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p) return "index";
  return p;
}

function resolveRawHtmlFileInRoot(root: string, routePath: string): string {
  const rel = normalizeRawHtmlRoutePath(routePath);

  // Normalize and ensure the resolved path stays within `content/**/raw`.
  const file = path.normalize(path.join(root, `${rel}.html`));
  const rootNorm = path.normalize(root + path.sep);
  if (!file.startsWith(rootNorm)) {
    throw new Error(`Invalid route path: ${routePath}`);
  }
  return file;
}

export function resolveRawHtmlFile(routePath: string): string {
  const root = getRawHtmlRoots()[0];
  if (!root) throw new Error("Missing generated raw content root");
  return resolveRawHtmlFileInRoot(root, routePath);
}

export function getGeneratedContentDir(): string {
  return path.join(process.cwd(), "content", "generated");
}

export function getNotionSyncCacheDir(): string {
  return path.join(process.cwd(), ".next", "cache", "notion-sync");
}

/**
 * Return raw-html "rel paths" (without ".html") from generated content.
 * Example values: "index", "bio", "blog/list/<slug>".
 */
export function listRawHtmlRelPaths(): string[] {
  return listRawHtmlFiles().map((item) => item.relPath);
}

/**
 * Return raw-html files (rel path + file path + mtimeMs) from generated content.
 */
export function listRawHtmlFiles(): RawHtmlFileInfo[] {
  const root = getRawHtmlRoots()[0];
  const out: RawHtmlFileInfo[] = [];

  if (!root || !isDirSync(root)) return out;
  const files = listHtmlFilesRecSync(root);
  for (const abs of files) {
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    if (!rel.endsWith(".html")) continue;
    const noExt = rel.slice(0, -".html".length);
    if (!noExt) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch {
      // ignore
    }
    out.push({
      relPath: noExt,
      filePath: abs,
      mtimeMs,
    });
  }

  // Deterministic output.
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}
