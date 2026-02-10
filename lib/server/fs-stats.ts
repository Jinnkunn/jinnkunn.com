import "server-only";

import fs from "node:fs";

export function safeStat(filePath: string): { exists: boolean; mtimeMs?: number; size?: number } {
  try {
    const st = fs.statSync(filePath);
    return { exists: st.isFile(), mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { exists: false };
  }
}

export function safeDir(filePath: string): { exists: boolean; mtimeMs?: number; size?: number; count?: number } {
  try {
    const st = fs.statSync(filePath);
    if (!st.isDirectory()) return { exists: false };
    const items = fs.readdirSync(filePath);
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size, count: items.length };
  } catch {
    return { exists: false };
  }
}

