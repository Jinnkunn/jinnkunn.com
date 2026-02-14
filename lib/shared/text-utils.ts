import {
  escapeHtml as escapeHtmlRaw,
  tokenizeQuery as tokenizeQueryRaw,
} from "./text-utils.mjs";

export const escapeHtml = escapeHtmlRaw as (
  s: unknown,
) => string;

export const tokenizeQuery = tokenizeQueryRaw as (
  q: unknown,
  opts?: { maxTerms?: number },
) => string[];
