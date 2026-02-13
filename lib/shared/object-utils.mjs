// Shared, side-effect-free object helpers used by both build scripts (Node)
// and the Next.js runtime. Keep this file ESM and dependency-free.

/**
 * @param {unknown} x
 * @returns {x is Record<string, unknown>}
 */
export function isObject(x) {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

/**
 * Deep-merge `patch` into `base` (plain objects only).
 * @template {Record<string, unknown>} T
 * @param {T} base
 * @param {unknown} patch
 * @returns {T}
 */
export function deepMerge(base, patch) {
  if (!isObject(base) || !isObject(patch)) return base;
  const out = { ...base };
  /** @type {Record<string, unknown>} */
  const record = out;

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const current = record[k];
    if (isObject(current) && isObject(v)) {
      record[k] = deepMerge(current, v);
      continue;
    }
    record[k] = v;
  }
  return /** @type {T} */ (record);
}
