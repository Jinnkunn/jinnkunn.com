export function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: unknown,
): T {
  if (!isObject(base) || !isObject(patch)) return base;
  const out: Record<string, unknown> = { ...base };

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const current = out[k];
    if (isObject(current) && isObject(v)) {
      out[k] = deepMerge(current, v);
      continue;
    }
    out[k] = v;
  }
  return out as T;
}
