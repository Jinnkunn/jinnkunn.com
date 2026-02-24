import { tokenizeQuery } from "../shared/text-utils.ts";

export type SearchScoreInput = {
  title: string;
  route: string;
  text?: string;
  query: string;
  navBoost?: number;
};

function safeLower(s: unknown): string {
  return String(s ?? "").toLowerCase();
}

function bestPos(hay: string, terms: string[]): number {
  let best = -1;
  for (const t of terms) {
    if (!t) continue;
    const i = hay.indexOf(t);
    if (i < 0) continue;
    if (best === -1 || i < best) best = i;
  }
  return best;
}

function hasAllTerms(hay: string, terms: string[]): boolean {
  if (!terms.length) return true;
  return terms.every((t) => hay.includes(t));
}

function hasPhrase(hay: string, ql: string): boolean {
  if (!ql || ql.length < 3) return false;
  return hay.includes(ql);
}

export function scoreSearchResult(input: SearchScoreInput): number {
  const title = String(input?.title || "");
  const route = String(input?.route || "");
  const text = String(input?.text || "");
  const query = String(input?.query || "");
  const navBoost = Number(input?.navBoost || 0) || 0;

  const ql = safeLower(query.trim());
  const terms = tokenizeQuery(query);

  const titleHay = safeLower(title);
  const routeHay = safeLower(route);
  const textHay = safeLower(text);

  const titlePos = bestPos(titleHay, terms);
  const routePos = bestPos(routeHay, terms);
  const textPos = bestPos(textHay, terms);

  const titlePhrase = hasPhrase(titleHay, ql);
  const routePhrase = hasPhrase(routeHay, ql);
  const textPhrase = hasPhrase(textHay, ql);

  const titleAll = terms.length > 1 && hasAllTerms(titleHay, terms);
  const routeAll = terms.length > 1 && hasAllTerms(routeHay, terms);
  const textAll = terms.length > 1 && hasAllTerms(textHay, terms);

  const base =
    (titlePos === -1 ? 5000 : titlePos) +
    (routePos === -1 ? 8000 : routePos + 50) +
    (textPos === -1 ? 12000 : textPos + 200);

  const depthPenalty = Math.min(260, route.split("/").filter(Boolean).length * 18);
  const textLenPenalty = Math.min(900, Math.floor(text.length / 160));

  const boosts =
    (titlePhrase ? 2200 : 0) +
    (textPhrase ? 700 : 0) +
    (routePhrase ? 400 : 0) +
    (titleAll ? 900 : 0) +
    (routeAll ? 500 : 0) +
    (textAll ? 300 : 0) +
    Math.max(0, navBoost);

  return base + depthPenalty + textLenPenalty - boosts;
}
