import "server-only";

import fs from "node:fs";

export function safeStat(filePath: string): { exists: boolean; mtimeMs?: number; size?: number } {
  try {
    const st = fs.statSync(filePath);
    return { exists: st.isFile(), mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    // Cloudflare Workers (with nodejs_compat + opennextjs) bundles
    // content/**/*.json as Data modules; fs.statSync can fail for those even
    // when the file is reachable via readFileSync. Fall through to a read so
    // the Status panel doesn't lie about bundled files being absent. We lose
    // mtimeMs in that path because there's no stat to read it from.
    try {
      const data = fs.readFileSync(filePath);
      return { exists: true, size: data.length };
    } catch {
      return { exists: false };
    }
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

