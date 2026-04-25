import type {
  StructuredPageSection,
  StructuredPageSectionType,
} from "./types";

export const PUBLICATIONS_SECTIONS: StructuredPageSection[] = [
  { id: "profile-links", type: "profileLinks", enabled: true, width: "standard" },
  { id: "publication-list", type: "entries", enabled: true, width: "standard" },
];

export const TEACHING_SECTIONS: StructuredPageSection[] = [
  { id: "intro", type: "intro", enabled: true, width: "standard" },
  { id: "header-links", type: "headerLinks", enabled: true, width: "standard" },
  { id: "teaching-list", type: "entries", enabled: true, width: "standard" },
  { id: "footer-links", type: "footerLinks", enabled: true, width: "standard" },
];

export const WORKS_SECTIONS: StructuredPageSection[] = [
  { id: "intro", type: "intro", enabled: true, width: "standard" },
  { id: "recent-works", type: "recentWorks", enabled: true, width: "standard" },
  { id: "passed-works", type: "passedWorks", enabled: true, width: "standard" },
  { id: "note", type: "note", enabled: true, width: "standard" },
];

const VALID_TYPES = new Set<StructuredPageSectionType>([
  "intro",
  "profileLinks",
  "entries",
  "recentWorks",
  "passedWorks",
  "note",
  "headerLinks",
  "footerLinks",
  "richText",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeStructuredPageSections(
  raw: unknown,
  defaults: StructuredPageSection[],
): StructuredPageSection[] {
  if (!Array.isArray(raw)) return defaults.map((item) => ({ ...item }));
  const out: StructuredPageSection[] = [];
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value)) continue;
    const type =
      typeof value.type === "string" && VALID_TYPES.has(value.type as StructuredPageSectionType)
        ? (value.type as StructuredPageSectionType)
        : null;
    if (!type) continue;
    const width =
      value.width === "narrow" || value.width === "wide" ? value.width : "standard";
    const section: StructuredPageSection = {
      id: optionalString(value.id) || `${type}-${index + 1}`,
      type,
      enabled: typeof value.enabled === "boolean" ? value.enabled : true,
      width,
    };
    const title = optionalString(value.title);
    const body = optionalString(value.body);
    if (title) section.title = title;
    if (body) section.body = body;
    out.push(section);
  }
  return out.length ? out : defaults.map((item) => ({ ...item }));
}

export function createRichTextSection(): StructuredPageSection {
  return {
    id: `rich-text-${Date.now().toString(36)}`,
    type: "richText",
    enabled: true,
    title: "New section",
    body: "",
    width: "standard",
  };
}

export function structuredPageSectionLabel(type: StructuredPageSectionType): string {
  switch (type) {
    case "intro":
      return "Intro";
    case "profileLinks":
      return "Profile links";
    case "entries":
      return "Main list";
    case "recentWorks":
      return "Recent works";
    case "passedWorks":
      return "Passed works";
    case "note":
      return "Footer note";
    case "headerLinks":
      return "Header links";
    case "footerLinks":
      return "Footer links";
    case "richText":
      return "Rich text";
  }
}
