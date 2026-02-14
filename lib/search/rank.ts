import { scoreSearchResult as scoreSearchResultRaw } from "./rank.mjs";

export type SearchScoreInput = {
  title: string;
  route: string;
  text?: string;
  query: string;
  navBoost?: number;
};

export const scoreSearchResult = scoreSearchResultRaw as (
  input: SearchScoreInput,
) => number;
