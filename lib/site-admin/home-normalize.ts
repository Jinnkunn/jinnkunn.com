import type {
  SiteAdminHomeData,
  SiteAdminHomeFeaturedPagesSection,
  SiteAdminHomeHeroSection,
  SiteAdminHomeImageBlock,
  SiteAdminHomeLayoutBlock,
  SiteAdminHomeLayoutSection,
  SiteAdminHomeLink,
  SiteAdminHomeLinkListSection,
  SiteAdminHomeMarkdownBlock,
  SiteAdminHomeRichTextSection,
  SiteAdminHomeSection,
  SiteAdminHomeSectionWidth,
  SiteAdminHomeTextAlign,
} from "./api-types";

const SCHEMA_VERSION = 3;

const EMPTY_DATA: SiteAdminHomeData = {
  schemaVersion: SCHEMA_VERSION,
  title: "Hi there!",
  sections: [],
};

function readRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function readString(raw: unknown, fallback = ""): string {
  return typeof raw === "string" ? raw : fallback;
}

function readOptionalString(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

function readBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function readEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof raw === "string" && allowed.includes(raw as T)
    ? (raw as T)
    : fallback;
}

function normalizeId(raw: unknown, type: string, index: number): string {
  return readOptionalString(raw) ?? `${type}-${index + 1}`;
}

function normalizeWidth(raw: unknown): SiteAdminHomeSectionWidth {
  return readEnum(raw, ["narrow", "standard", "wide"] as const, "standard");
}

function normalizeTextAlign(raw: unknown): SiteAdminHomeTextAlign {
  return readEnum(raw, ["left", "center"] as const, "left");
}

function normalizeColumn(raw: unknown, columns: 1 | 2 | 3): 1 | 2 | 3 {
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 1;
  if (columns === 1) return 1;
  if (columns === 2) return value === 2 ? 2 : 1;
  return value === 2 || value === 3 ? value : 1;
}

function normalizeLinks(raw: unknown): SiteAdminHomeLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = readRecord(item);
      if (!r) return null;
      const label = readString(r.label).trim();
      const href = readString(r.href).trim();
      if (!label && !href) return null;
      const link: SiteAdminHomeLink = {
        label: label || href || "Untitled link",
        href,
      };
      const description = readOptionalString(r.description);
      if (description) link.description = description;
      return link;
    })
    .filter((item): item is SiteAdminHomeLink => Boolean(item));
}

function normalizeLayoutBlocks(raw: unknown, columns: 1 | 2 | 3): SiteAdminHomeLayoutBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const r = readRecord(item);
      if (!r) return null;
      const type = readEnum(r.type, ["markdown", "image"] as const, "markdown");
      const base = {
        id: normalizeId(r.id, type, index),
        column: normalizeColumn(r.column, columns),
      };
      if (type === "image") {
        const url = readString(r.url).trim();
        if (!url) return null;
        const block: SiteAdminHomeImageBlock = {
          ...base,
          type,
          url,
          shape: readEnum(
            r.shape,
            ["rounded", "portrait", "circle", "square"] as const,
            "rounded",
          ),
          fit: readEnum(r.fit, ["cover", "contain"] as const, "cover"),
        };
        const alt = readOptionalString(r.alt);
        const caption = readOptionalString(r.caption);
        if (alt) block.alt = alt;
        if (caption) block.caption = caption;
        return block;
      }
      const block: SiteAdminHomeMarkdownBlock = {
        ...base,
        type: "markdown",
        body: readString(r.body),
        tone: readEnum(r.tone, ["plain", "panel", "quote"] as const, "plain"),
        textAlign: normalizeTextAlign(r.textAlign),
      };
      const title = readOptionalString(r.title);
      if (title) block.title = title;
      return block;
    })
    .filter((item): item is SiteAdminHomeLayoutBlock => Boolean(item));
}

function emptyRichTextSection(): SiteAdminHomeRichTextSection {
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

function normalizeSection(
  raw: unknown,
  index: number,
): SiteAdminHomeSection | null {
  const r = readRecord(raw);
  if (!r) return null;
  const type = readEnum(
    r.type,
    ["hero", "richText", "linkList", "featuredPages", "layout"] as const,
    "richText",
  );
  const base = {
    id: normalizeId(r.id, type, index),
    enabled: readBoolean(r.enabled, true),
  };

  if (type === "hero") {
    const section: SiteAdminHomeHeroSection = {
      ...base,
      type,
      title: readString(r.title).trim() || EMPTY_DATA.title,
      body: readString(r.body),
      imagePosition: readEnum(
        r.imagePosition,
        ["left", "right", "top", "none"] as const,
        readOptionalString(r.profileImageUrl) ? "left" : "none",
      ),
      textAlign: normalizeTextAlign(r.textAlign),
      width: normalizeWidth(r.width),
    };
    const profileImageUrl = readOptionalString(r.profileImageUrl);
    const profileImageAlt = readOptionalString(r.profileImageAlt);
    if (profileImageUrl) section.profileImageUrl = profileImageUrl;
    if (profileImageAlt) section.profileImageAlt = profileImageAlt;
    return section;
  }

  if (type === "linkList") {
    const section: SiteAdminHomeLinkListSection = {
      ...base,
      type,
      title: readOptionalString(r.title),
      body: readOptionalString(r.body),
      layout: readEnum(r.layout, ["stack", "grid", "inline"] as const, "grid"),
      links: normalizeLinks(r.links),
      width: normalizeWidth(r.width),
    };
    return section;
  }

  if (type === "featuredPages") {
    const columns = r.columns === 3 ? 3 : 2;
    const section: SiteAdminHomeFeaturedPagesSection = {
      ...base,
      type,
      title: readOptionalString(r.title),
      body: readOptionalString(r.body),
      columns,
      items: normalizeLinks(r.items),
      width: normalizeWidth(r.width),
    };
    return section;
  }

  if (type === "layout") {
    const columns: 1 | 2 | 3 = r.columns === 1 || r.columns === 3 ? r.columns : 2;
    const section: SiteAdminHomeLayoutSection = {
      ...base,
      type,
      variant: readEnum(
        r.variant,
        ["standard", "classicIntro"] as const,
        "standard",
      ),
      columns,
      gap: readEnum(r.gap, ["compact", "standard", "loose"] as const, "standard"),
      verticalAlign: readEnum(r.verticalAlign, ["start", "center"] as const, "start"),
      blocks: normalizeLayoutBlocks(r.blocks, columns),
      width: normalizeWidth(r.width),
    };
    const title = readOptionalString(r.title);
    if (title) section.title = title;
    return section;
  }

  const section: SiteAdminHomeRichTextSection = {
    ...base,
    type: "richText",
    title: readOptionalString(r.title),
    body: readString(r.body),
    variant: readEnum(
      r.variant,
      ["standard", "classicBody"] as const,
      "standard",
    ),
    tone: readEnum(r.tone, ["plain", "panel", "quote"] as const, "plain"),
    textAlign: normalizeTextAlign(r.textAlign),
    width: normalizeWidth(r.width),
  };
  return section;
}

export function normalizeHomeData(raw: unknown): SiteAdminHomeData {
  const r = readRecord(raw);
  if (!r) return emptyHomeData();
  const sections = Array.isArray(r.sections)
    ? r.sections
        .map((section, index) => normalizeSection(section, index))
        .filter((section): section is SiteAdminHomeSection => Boolean(section))
    : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    title: readString(r.title).trim() || EMPTY_DATA.title,
    sections: sections.length > 0 ? sections : [emptyRichTextSection()],
  };
}

export function emptyHomeData(): SiteAdminHomeData {
  return {
    ...EMPTY_DATA,
    sections: [emptyRichTextSection()],
  };
}
