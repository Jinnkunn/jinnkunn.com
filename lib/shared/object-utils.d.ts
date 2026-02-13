export function isObject(x: unknown): x is Record<string, unknown>;
export function deepMerge<T extends Record<string, unknown>>(base: T, patch: unknown): T;
