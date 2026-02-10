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

