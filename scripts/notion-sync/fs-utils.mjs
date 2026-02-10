import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} p
 */
export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * @param {string} filePath
 * @returns {any|null}
 */
export function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
export function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
}

/**
 * @param {string} filePath
 * @param {string|Buffer|Uint8Array} contents
 */
export function writeFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
}

/**
 * @param {string} dir
 */
export function rmDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

