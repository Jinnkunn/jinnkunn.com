import {
  deepMerge as deepMergeRaw,
  isObject as isObjectRaw,
} from "./object-utils.mjs";

export const isObject = isObjectRaw as (
  x: unknown,
) => x is Record<string, unknown>;

export const deepMerge = deepMergeRaw as <T extends Record<string, unknown>>(
  base: T,
  patch: unknown,
) => T;
