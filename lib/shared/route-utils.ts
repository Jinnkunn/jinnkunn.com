import {
  compactId as compactIdRaw,
  dashify32 as dashify32Raw,
  normalizeRoutePath as normalizeRoutePathRaw,
  slugify as slugifyRaw,
} from "./route-utils.mjs";

export const compactId = compactIdRaw as (
  idOrUrl: string,
) => string;

export const slugify = slugifyRaw as (
  input: string,
) => string;

export const normalizeRoutePath = normalizeRoutePathRaw as (
  p: string,
) => string;

export const dashify32 = dashify32Raw as (
  id32: string,
) => string;
