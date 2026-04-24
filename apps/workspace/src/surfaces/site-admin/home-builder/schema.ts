import type {
  HomeData,
  HomeFeaturedPagesSection,
  HomeHeroSection,
  HomeImageBlock,
  HomeLink,
  HomeLinkListSection,
  HomeLayoutBlock,
  HomeLayoutSection,
  HomeMarkdownBlock,
  HomeRichTextSection,
  HomeSection,
  HomeSectionType,
} from "../types";

export const SECTION_LABELS: Record<HomeSectionType, string> = {
  hero: "Hero",
  richText: "Rich text",
  linkList: "Links",
  featuredPages: "Featured pages",
  layout: "Layout",
};

const SCHEMA_VERSION = 3;

const FEATURED_PAGE_DEFAULTS: HomeLink[] = [
  { label: "Publications", href: "/publications", description: "Research papers and preprints." },
  { label: "Works", href: "/works", description: "Research, teaching, and industry work." },
  { label: "News", href: "/news", description: "Recent updates and milestones." },
];

export function createId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sameData(a: HomeData, b: HomeData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function text(raw: unknown, fallback = ""): string {
  return typeof raw === "string" ? raw : fallback;
}

function optionalText(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function oneOf<T extends string>(raw: unknown, values: readonly T[], fallback: T): T {
  return typeof raw === "string" && values.includes(raw as T)
    ? (raw as T)
    : fallback;
}

function normalizeLinks(raw: unknown): HomeLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = asRecord(item);
      if (!r) return null;
      const label = text(r.label).trim();
      const href = text(r.href).trim();
      if (!label && !href) return null;
      const link: HomeLink = {
        label: label || href || "Untitled link",
        href,
      };
      const description = optionalText(r.description);
      if (description) link.description = description;
      return link;
    })
    .filter((item): item is HomeLink => Boolean(item));
}

function normalizeColumn(raw: unknown, columns: 1 | 2 | 3): 1 | 2 | 3 {
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 1;
  if (columns === 1) return 1;
  if (columns === 2) return value === 2 ? 2 : 1;
  return value === 2 || value === 3 ? value : 1;
}

function normalizeLayoutBlocks(raw: unknown, columns: 1 | 2 | 3): HomeLayoutBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const r = asRecord(item);
      if (!r) return null;
      const type = oneOf(r.type, ["markdown", "image"] as const, "markdown");
      const base = {
        id: optionalText(r.id) || `${type}-${index + 1}`,
        column: normalizeColumn(r.column, columns),
      };
      if (type === "image") {
        const url = text(r.url).trim();
        if (!url) return null;
        const block: HomeImageBlock = {
          ...base,
          type,
          url,
          shape: oneOf(
            r.shape,
            ["rounded", "portrait", "circle", "square"] as const,
            "rounded",
          ),
          fit: oneOf(r.fit, ["cover", "contain"] as const, "cover"),
        };
        const alt = optionalText(r.alt);
        const caption = optionalText(r.caption);
        if (alt) block.alt = alt;
        if (caption) block.caption = caption;
        return block;
      }
      const block: HomeMarkdownBlock = {
        ...base,
        type: "markdown",
        body: text(r.body),
        tone: oneOf(r.tone, ["plain", "panel", "quote"] as const, "plain"),
        textAlign: oneOf(r.textAlign, ["left", "center"] as const, "left"),
      };
      const title = optionalText(r.title);
      if (title) block.title = title;
      return block;
    })
    .filter((item): item is HomeLayoutBlock => Boolean(item));
}

function createHeroSection(
  input: {
    title?: string;
    body?: string;
    profileImageUrl?: string;
    profileImageAlt?: string;
  } = {},
): HomeHeroSection {
  const section: HomeHeroSection = {
    id: "hero-intro",
    type: "hero",
    enabled: true,
    title: input.title || "Hi there!",
    body: typeof input.body === "string" ? input.body : "",
    imagePosition: input.profileImageUrl ? "left" : "none",
    textAlign: "left",
    width: "standard",
  };
  if (input.profileImageUrl) section.profileImageUrl = input.profileImageUrl;
  if (input.profileImageAlt) section.profileImageAlt = input.profileImageAlt;
  return section;
}

export function createSection(type: HomeSectionType): HomeSection {
  if (type === "hero") {
    return {
      ...createHeroSection({ title: "New hero" }),
      id: createId(type),
      imagePosition: "none",
    };
  }
  if (type === "linkList") {
    const section: HomeLinkListSection = {
      id: createId(type),
      type,
      enabled: true,
      title: "Links",
      body: "",
      layout: "grid",
      links: [{ label: "New link", href: "/" }],
      width: "standard",
    };
    return section;
  }
  if (type === "featuredPages") {
    const section: HomeFeaturedPagesSection = {
      id: createId(type),
      type,
      enabled: true,
      title: "Featured pages",
      body: "A quick path into the main sections of the site.",
      columns: 3,
      items: clone(FEATURED_PAGE_DEFAULTS),
      width: "standard",
    };
    return section;
  }
  if (type === "layout") {
    const section: HomeLayoutSection = {
      id: createId(type),
      type,
      enabled: true,
      title: "Image and text",
      variant: "standard",
      columns: 2,
      gap: "standard",
      verticalAlign: "center",
      width: "wide",
      blocks: [
        {
          id: createId("image"),
          type: "image",
          column: 1,
          url: "",
          alt: "",
          caption: "",
          shape: "portrait",
          fit: "cover",
        },
        {
          id: createId("markdown"),
          type: "markdown",
          column: 2,
          title: "Section title",
          body: "Write anything here with markdown.",
          tone: "plain",
          textAlign: "left",
        },
      ],
    };
    return section;
  }
  const section: HomeRichTextSection = {
    id: createId(type),
    type,
    enabled: true,
    title: "Section title",
    body: "",
    variant: "standard",
    tone: "plain",
    textAlign: "left",
    width: "standard",
  };
  return section;
}

function normalizeSection(raw: unknown, index: number): HomeSection | null {
  const r = asRecord(raw);
  if (!r) return null;
  const type = oneOf(
    r.type,
    ["hero", "richText", "linkList", "featuredPages", "layout"] as const,
    "richText",
  );
  const base = {
    id: optionalText(r.id) || `${type}-${index + 1}`,
    enabled: bool(r.enabled, true),
  };

  if (type === "hero") {
    const section: HomeHeroSection = {
      ...base,
      type,
      title: text(r.title).trim() || "Hi there!",
      body: text(r.body),
      imagePosition: oneOf(
        r.imagePosition,
        ["left", "right", "top", "none"] as const,
        optionalText(r.profileImageUrl) ? "left" : "none",
      ),
      textAlign: oneOf(r.textAlign, ["left", "center"] as const, "left"),
      width: oneOf(r.width, ["narrow", "standard", "wide"] as const, "standard"),
    };
    const profileImageUrl = optionalText(r.profileImageUrl);
    const profileImageAlt = optionalText(r.profileImageAlt);
    if (profileImageUrl) section.profileImageUrl = profileImageUrl;
    if (profileImageAlt) section.profileImageAlt = profileImageAlt;
    return section;
  }

  if (type === "linkList") {
    return {
      ...base,
      type,
      title: optionalText(r.title),
      body: optionalText(r.body),
      layout: oneOf(r.layout, ["stack", "grid", "inline"] as const, "grid"),
      links: normalizeLinks(r.links),
      width: oneOf(r.width, ["narrow", "standard", "wide"] as const, "standard"),
    };
  }

  if (type === "featuredPages") {
    return {
      ...base,
      type,
      title: optionalText(r.title),
      body: optionalText(r.body),
      columns: r.columns === 2 ? 2 : 3,
      items: normalizeLinks(r.items),
      width: oneOf(r.width, ["narrow", "standard", "wide"] as const, "standard"),
    };
  }

  if (type === "layout") {
    const columns: 1 | 2 | 3 = r.columns === 1 || r.columns === 3 ? r.columns : 2;
    const section: HomeLayoutSection = {
      ...base,
      type,
      variant: oneOf(
        r.variant,
        ["standard", "classicIntro"] as const,
        "standard",
      ),
      columns,
      gap: oneOf(r.gap, ["compact", "standard", "loose"] as const, "standard"),
      verticalAlign: oneOf(r.verticalAlign, ["start", "center"] as const, "start"),
      blocks: normalizeLayoutBlocks(r.blocks, columns),
      width: oneOf(r.width, ["narrow", "standard", "wide"] as const, "standard"),
    };
    const title = optionalText(r.title);
    if (title) section.title = title;
    return section;
  }

  return {
    ...base,
    type: "richText",
    title: optionalText(r.title),
    body: text(r.body),
    variant: oneOf(
      r.variant,
      ["standard", "classicBody"] as const,
      "standard",
    ),
    tone: oneOf(r.tone, ["plain", "panel", "quote"] as const, "plain"),
    textAlign: oneOf(r.textAlign, ["left", "center"] as const, "left"),
    width: oneOf(r.width, ["narrow", "standard", "wide"] as const, "standard"),
  };
}

function emptyRichTextSection(): HomeRichTextSection {
  return {
    id: "home-empty",
    type: "richText",
    enabled: true,
    body: "",
    variant: "standard",
    tone: "plain",
    textAlign: "left",
    width: "standard",
  };
}

export function prepareHomeDataForSave(data: HomeData): HomeData {
  return normalizeHomeData({
    title: data.title,
    sections: data.sections,
  });
}

export function normalizeHomeData(raw: unknown): HomeData {
  const r = asRecord(raw) || {};
  const sections = Array.isArray(r.sections)
    ? r.sections
        .map((section, index) => normalizeSection(section, index))
        .filter((section): section is HomeSection => Boolean(section))
    : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    title: text(r.title).trim() || "Hi there!",
    sections: sections.length ? sections : [emptyRichTextSection()],
  };
}

export const BLANK_HOME_DATA = normalizeHomeData({});

export function sectionTitle(section: HomeSection): string {
  if (section.type === "hero") return section.title || "Untitled hero";
  if (section.type === "layout") return section.title || "Layout";
  return section.title || SECTION_LABELS[section.type];
}

export function sectionSummary(section: HomeSection): string {
  if (section.type === "linkList") {
    return `${section.links.length} link${section.links.length === 1 ? "" : "s"} · ${section.layout}`;
  }
  if (section.type === "featuredPages") {
    return `${section.items.length} page${section.items.length === 1 ? "" : "s"} · ${section.columns} columns`;
  }
  if (section.type === "layout") {
    return `${section.blocks.length} block${section.blocks.length === 1 ? "" : "s"} · ${section.columns} columns`;
  }
  const body = section.body.trim().replace(/\s+/g, " ");
  return body ? body.slice(0, 88) : "Empty body";
}
