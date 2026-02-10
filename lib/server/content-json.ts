import "server-only";

import fs from "node:fs";

import { findContentFile, readJsonFile } from "@/lib/server/content-files";

type Cached = { file: string; mtimeMs: number; parsed: unknown };

let __cache: Cached | null = null;
const __cacheByFile = new Map<string, Cached>();

export function readContentJsonWithStat(relPath: string): { file: string; mtimeMs: number; parsed: unknown } | null {
  const file = findContentFile(relPath);
  if (!file) return null;

  try {
    const st = fs.statSync(file);
    const mtimeMs = st.mtimeMs;

    // Fast path: single-entry cache for very hot files.
    if (__cache && __cache.file === file && __cache.mtimeMs === mtimeMs) return __cache;

    // File-keyed cache for multiple JSON files.
    const hit = __cacheByFile.get(file);
    if (hit && hit.mtimeMs === mtimeMs) {
      __cache = hit;
      return hit;
    }

    const parsed = readJsonFile(file);
    const next: Cached = { file, mtimeMs, parsed };
    __cacheByFile.set(file, next);
    __cache = next;
    return next;
  } catch {
    return null;
  }
}

export function readContentJson(relPath: string): unknown | null {
  return readContentJsonWithStat(relPath)?.parsed ?? null;
}

