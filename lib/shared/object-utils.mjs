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
 * @template T
 * @param {T} base
 * @param {unknown} patch
 * @returns {T}
 */
export function deepMerge(base, patch) {
  if (!isObject(patch)) return base;
  // @ts-ignore - callers treat T as object-ish
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    // @ts-ignore
    if (isObject(out[k]) && isObject(v)) out[k] = deepMerge(out[k], v);
    // @ts-ignore
    else out[k] = v;
  }
  return out;
}

