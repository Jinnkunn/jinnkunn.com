import type {
  SiteAdminStructuredPageSection,
  SiteAdminStructuredPageSectionType,
} from "./api-types.ts";

const VALID_SECTION_TYPES = new Set<SiteAdminStructuredPageSectionType>([
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

const VALID_WIDTHS = new Set(["narrow", "standard", "wide"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeStructuredPageSections(
  raw: unknown,
  defaults: SiteAdminStructuredPageSection[],
): SiteAdminStructuredPageSection[] {
  if (!Array.isArray(raw)) return defaults.map((item) => ({ ...item }));
  const out: SiteAdminStructuredPageSection[] = [];
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value)) continue;
    const type =
      typeof value.type === "string" &&
      VALID_SECTION_TYPES.has(value.type as SiteAdminStructuredPageSectionType)
        ? (value.type as SiteAdminStructuredPageSectionType)
        : null;
    if (!type) continue;
    const width =
      typeof value.width === "string" && VALID_WIDTHS.has(value.width)
        ? (value.width as SiteAdminStructuredPageSection["width"])
        : "standard";
    const section: SiteAdminStructuredPageSection = {
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

export const PUBLICATIONS_SECTIONS: SiteAdminStructuredPageSection[] = [
  { id: "profile-links", type: "profileLinks", enabled: true, width: "standard" },
  { id: "publication-list", type: "entries", enabled: true, width: "standard" },
];

export const TEACHING_SECTIONS: SiteAdminStructuredPageSection[] = [
  { id: "intro", type: "intro", enabled: true, width: "standard" },
  { id: "header-links", type: "headerLinks", enabled: true, width: "standard" },
  { id: "teaching-list", type: "entries", enabled: true, width: "standard" },
  { id: "footer-links", type: "footerLinks", enabled: true, width: "standard" },
];

export const WORKS_SECTIONS: SiteAdminStructuredPageSection[] = [
  { id: "intro", type: "intro", enabled: true, width: "standard" },
  { id: "recent-works", type: "recentWorks", enabled: true, width: "standard" },
  { id: "passed-works", type: "passedWorks", enabled: true, width: "standard" },
  { id: "note", type: "note", enabled: true, width: "standard" },
];
