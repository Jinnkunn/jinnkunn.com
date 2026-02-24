import { compactId, normalizeRoutePath } from "./route-utils.ts";

function splitStringEntries(raw: unknown): string[] {
  return String(raw || "")
    .split(/[\n,]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeSitemapExcludeEntry(raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const maybeId = compactId(s);
  if (s.startsWith("/")) {
    const bare = s.replace(/^\/+/, "");
    if (maybeId && /^[0-9a-f-]{32,36}$/i.test(bare)) return maybeId;
    const route = normalizeRoutePath(s);
    if (route) return route;
    return maybeId || "";
  }
  if (maybeId) return maybeId;
  const route = normalizeRoutePath(s);
  if (route) return route;
  const id = compactId(s);
  if (id) return id;
  return "";
}

export function parseSitemapExcludeEntries(input: unknown): string[] {
  const chunks = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const parts = Array.isArray(chunk) ? chunk : splitStringEntries(chunk);
    for (const part of parts) {
      const normalized = normalizeSitemapExcludeEntry(part);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}
