import { normalizeRoutePath } from "./route-utils.ts";

export type SeoPageOverride = {
  title?: string;
  description?: string;
  ogImage?: string;
  canonicalPath?: string;
  noindex?: boolean;
};

export type SeoPageOverrides = Record<string, SeoPageOverride>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown, maxLen = 1200): string {
  if (typeof value !== "string") return "";
  const s = value.trim();
  if (!s) return "";
  return s.slice(0, maxLen);
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return null;
}

function parseUnknownInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const s = input.trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function normalizeSingleOverride(raw: unknown): SeoPageOverride | null {
  if (!isObject(raw)) return null;
  const title = asTrimmedString(raw.title, 320);
  const description = asTrimmedString(raw.description, 1000);
  const ogImage = asTrimmedString(raw.ogImage, 1200);
  const canonicalPath = normalizeRoutePath(asTrimmedString(raw.canonicalPath, 400));
  const noindex = asBoolean(raw.noindex);

  const out: SeoPageOverride = {};
  if (title) out.title = title;
  if (description) out.description = description;
  if (ogImage) out.ogImage = ogImage;
  if (canonicalPath) out.canonicalPath = canonicalPath;
  if (typeof noindex === "boolean") out.noindex = noindex;
  return Object.keys(out).length > 0 ? out : null;
}

export function normalizeSeoPageOverrides(input: unknown): SeoPageOverrides {
  const parsed = parseUnknownInput(input);
  if (!isObject(parsed)) return {};

  const out: SeoPageOverrides = {};
  for (const [rawPath, rawOverride] of Object.entries(parsed)) {
    const path = normalizeRoutePath(rawPath);
    if (!path) continue;
    if (/\s/.test(path)) continue;
    const normalized = normalizeSingleOverride(rawOverride);
    if (!normalized) continue;
    out[path] = normalized;
  }

  return out;
}
