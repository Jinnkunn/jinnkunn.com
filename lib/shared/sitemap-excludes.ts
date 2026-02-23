import {
  normalizeSitemapExcludeEntry as normalizeSitemapExcludeEntryRaw,
  parseSitemapExcludeEntries as parseSitemapExcludeEntriesRaw,
} from "./sitemap-excludes.mjs";

export const normalizeSitemapExcludeEntry = normalizeSitemapExcludeEntryRaw as (
  raw: unknown,
) => string;

export const parseSitemapExcludeEntries = parseSitemapExcludeEntriesRaw as (
  input: unknown,
) => string[];
