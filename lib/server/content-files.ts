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
  return [
    path.join(process.cwd(), "content", "generated", rel),
    path.join(process.cwd(), "content", rel),
  ];
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

export function readContentJson(relPath: string): unknown | null {
  const file = findContentFile(relPath);
  if (!file) return null;
  return readJsonFile(file);
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

function isDirSync(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function getRawHtmlRoots(): string[] {
  return [
    path.join(process.cwd(), "content", "generated", "raw"),
    path.join(process.cwd(), "content", "raw"),
  ];
}

export function getGeneratedContentDir(): string {
  return path.join(process.cwd(), "content", "generated");
}

export function getNotionSyncCacheDir(): string {
  return path.join(process.cwd(), ".next", "cache", "notion-sync");
}

/**
 * Return deduped raw-html "rel paths" (without ".html") across generated + legacy roots.
 * Example values: "index", "bio", "blog/list/<slug>".
 */
export function listRawHtmlRelPaths(): string[] {
  const roots = getRawHtmlRoots();
  const seen = new Set<string>();
  const out: string[] = [];

  for (const root of roots) {
    if (!isDirSync(root)) continue;
    const files = listHtmlFilesRecSync(root);
    for (const abs of files) {
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (!rel.endsWith(".html")) continue;
      const noExt = rel.slice(0, -".html".length);
      if (!noExt || seen.has(noExt)) continue;
      seen.add(noExt);
      out.push(noExt);
    }
  }

  // Deterministic output.
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
