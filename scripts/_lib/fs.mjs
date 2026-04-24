import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Shared filesystem helpers for repo scripts.
 *
 * Several smoke / snapshot / audit scripts each reimplemented the same
 * "render an ISO timestamp suitable for a directory name" and "ensure
 * this path exists before writing" routines. Collecting them here keeps
 * script authoring boring and makes future changes (e.g. switching to
 * a different timestamp format) a one-line edit.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function isoStampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function envFlag(name) {
  return TRUE_VALUES.has(String(process.env[name] || "").trim().toLowerCase());
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function ensureOutputDir(outRoot, stamp = isoStampForPath()) {
  const dir = path.join(outRoot, stamp);
  await ensureDir(dir);
  return dir;
}

export async function writeJsonReport(filePath, payload) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export function normalizeOrigin(origin, fallback = "") {
  const raw = String(origin || "").trim();
  if (!raw) return fallback;
  return raw.replace(/\/+$/g, "");
}

export function normalizePath(pathname) {
  const p = String(pathname || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.replace(/\/+$/g, "") || "/";
}
