export type SiteComponentEntryType =
  | "news-entry"
  | "teaching-entry"
  | "publications-entry"
  | "works-entry";

export type SiteComponentDefinition = {
  name: string;
  label: string;
  description: string;
  sourcePath: `content/components/${string}.mdx`;
  contentRelPath: `components/${string}.mdx`;
  embedTag: `${string}Block`;
  entryTag: `${string}Entry`;
  entryLabel: string;
  entryType: SiteComponentEntryType;
  primaryRoute: string;
};

export const SITE_COMPONENT_DEFINITIONS = [
  {
    name: "news",
    label: "News",
    description: "Date-stamped updates rendered by <NewsBlock />.",
    sourcePath: "content/components/news.mdx",
    contentRelPath: "components/news.mdx",
    embedTag: "NewsBlock",
    entryTag: "NewsEntry",
    entryLabel: "News item",
    entryType: "news-entry",
    primaryRoute: "/news",
  },
  {
    name: "teaching",
    label: "Teaching",
    description: "Course rows rendered by <TeachingBlock />.",
    sourcePath: "content/components/teaching.mdx",
    contentRelPath: "components/teaching.mdx",
    embedTag: "TeachingBlock",
    entryTag: "TeachingEntry",
    entryLabel: "Teaching row",
    entryType: "teaching-entry",
    primaryRoute: "/teaching",
  },
  {
    name: "publications",
    label: "Publications",
    description: "Structured publication rows rendered by <PublicationsBlock />.",
    sourcePath: "content/components/publications.mdx",
    contentRelPath: "components/publications.mdx",
    embedTag: "PublicationsBlock",
    entryTag: "PublicationsEntry",
    entryLabel: "Publication",
    entryType: "publications-entry",
    primaryRoute: "/publications",
  },
  {
    name: "works",
    label: "Works",
    description: "Recent and past work rows rendered by <WorksBlock />.",
    sourcePath: "content/components/works.mdx",
    contentRelPath: "components/works.mdx",
    embedTag: "WorksBlock",
    entryTag: "WorksEntry",
    entryLabel: "Work row",
    entryType: "works-entry",
    primaryRoute: "/works",
  },
] as const satisfies readonly SiteComponentDefinition[];

export type SiteComponentName = (typeof SITE_COMPONENT_DEFINITIONS)[number]["name"];

export const SITE_COMPONENT_NAMES = SITE_COMPONENT_DEFINITIONS.map(
  (definition) => definition.name,
) as SiteComponentName[];

export function isSiteComponentName(value: unknown): value is SiteComponentName {
  return (
    typeof value === "string" &&
    (SITE_COMPONENT_NAMES as readonly string[]).includes(value)
  );
}

export function getSiteComponentDefinition(
  name: SiteComponentName,
): SiteComponentDefinition {
  const definition = SITE_COMPONENT_DEFINITIONS.find((item) => item.name === name);
  if (!definition) {
    throw new Error(`Unknown site component: ${name}`);
  }
  return definition;
}

export function getSiteComponentDefinitionByEmbedTag(
  embedTag: string,
): SiteComponentDefinition | null {
  return (
    SITE_COMPONENT_DEFINITIONS.find((item) => item.embedTag === embedTag) ?? null
  );
}
