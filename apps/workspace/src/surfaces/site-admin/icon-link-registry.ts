import rawRegistry from "../../../../../lib/shared/icon-link-registry.json";

export type IconLinkMatcherKind = "contains" | "exact" | "prefix";

export interface IconLinkMatcher {
  kind: IconLinkMatcherKind;
  value: string;
}

export interface IconLinkRegistryEntry {
  asset: string;
  backgroundSize: string;
  id: string;
  label: string;
  matchers: IconLinkMatcher[];
  route: string;
}

export const ICON_LINK_REGISTRY =
  rawRegistry as readonly IconLinkRegistryEntry[];

function normalizeHref(value: string): string {
  return value.trim();
}

function matchesHref(href: string, matcher: IconLinkMatcher): boolean {
  const normalized = normalizeHref(href);
  if (!normalized) return false;
  if (matcher.kind === "contains") return normalized.includes(matcher.value);
  if (matcher.kind === "prefix") return normalized.startsWith(matcher.value);
  if (normalized === matcher.value) return true;
  return normalized.replace(/\/+$/, "") === matcher.value.replace(/\/+$/, "");
}

export function findIconLinkEntryForHref(
  href: string,
): IconLinkRegistryEntry | null {
  return (
    ICON_LINK_REGISTRY.find((entry) =>
      entry.matchers.some((matcher) => matchesHref(href, matcher)),
    ) ?? null
  );
}

export function isKnownIconLinkHref(href: string): boolean {
  return Boolean(findIconLinkEntryForHref(href));
}
