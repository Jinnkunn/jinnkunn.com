import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const REGISTRY_PATH = path.join(ROOT, "lib/shared/icon-link-registry.json");

function readRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

function hrefSelector(matcher) {
  if (matcher.kind === "contains") return `href*="${matcher.value}"`;
  if (matcher.kind === "prefix") return `href^="${matcher.value}"`;
  return `href="${matcher.value}"`;
}

function selectorFor(entry) {
  const preferred =
    entry.matchers.find((matcher) => matcher.value.startsWith("https://www.")) ??
    entry.matchers.find((matcher) => matcher.kind === "exact") ??
    entry.matchers[0];
  return `span[data-link-style="icon"] > a[${hrefSelector(preferred)}].notion-link.link`;
}

export const CLASSIC_LINK_ICON_REGISTRY = readRegistry();

export const CLASSIC_LINK_ICON_CONTRACT = CLASSIC_LINK_ICON_REGISTRY.map(
  (entry) => ({
    name: entry.label,
    route: entry.route,
    selector: selectorFor(entry),
    asset: entry.asset,
  }),
);

export function classicLinkIconMatchers() {
  return CLASSIC_LINK_ICON_REGISTRY.flatMap((entry) =>
    entry.matchers.map((matcher) => ({ ...matcher, entry })),
  );
}
