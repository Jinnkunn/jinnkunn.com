import {
  parsePublicationsEntries,
  parseTeachingEntries,
  parseWorksEntries,
  type TeachingComponentEntry,
  type WorksComponentEntry,
} from "@/lib/components/parse";
import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";
import type { SiteComponentName } from "@jinnkunn/content-core/components";
import { parseMonthRangePeriod } from "./site-admin-month-range";

export type NewsDraftEntry = {
  id: string;
  type: "entry";
  date: string;
  body: string;
};

export type NewsDraftDivider = {
  id: string;
  type: "divider";
};

export type NewsDraftItem = NewsDraftEntry | NewsDraftDivider;

export type NewsComponentDraft = {
  frontmatter: string;
  items: NewsDraftItem[];
};

export type TeachingDraftEntry = Omit<TeachingComponentEntry, "entryId"> & {
  id: string;
};

export type TeachingComponentDraft = {
  frontmatter: string;
  items: TeachingDraftEntry[];
};

export type WorksDraftEntry = Omit<WorksComponentEntry, "entryId"> & {
  id: string;
};

export type WorksComponentDraft = {
  frontmatter: string;
  items: WorksDraftEntry[];
};

export type PublicationDraftEntry = Omit<PublicationStructuredEntry, "entryId"> & {
  id: string;
};

export type PublicationsComponentDraft = {
  frontmatter: string;
  items: PublicationDraftEntry[];
};

export type ComponentEntryIssue = {
  entryId: string;
  field: string;
  message: string;
};

export type ComponentGrouping = "auto" | "none";

const NEWS_ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;
const NEWS_ENTRY_RE = /<NewsEntry\b([\s\S]*?)>\s*([\s\S]*?)\s*<\/NewsEntry>/g;

export function todayInHalifax(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Halifax",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function createComponentEntryId(prefix: string) {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

export function newsEntryIssues(item: NewsDraftEntry): ComponentEntryIssue[] {
  const issues: ComponentEntryIssue[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    issues.push({ entryId: item.id, field: "date", message: "Choose a valid date." });
  }
  if (!item.body.trim()) {
    issues.push({ entryId: item.id, field: "body", message: "Add update text." });
  }
  return issues;
}

export function teachingEntryIssues(item: TeachingDraftEntry): ComponentEntryIssue[] {
  const issues: ComponentEntryIssue[] = [];
  if (!item.term.trim()) {
    issues.push({ entryId: item.id, field: "term", message: "Add a term." });
  }
  if (!item.courseCode.trim() && !item.courseName.trim()) {
    issues.push({
      entryId: item.id,
      field: "courseName",
      message: "Add a course code or course name.",
    });
  }
  if (!optionalUrlIsValid(item.courseUrl)) {
    issues.push({ entryId: item.id, field: "courseUrl", message: "Enter a valid URL." });
  }
  return issues;
}

export function worksEntryIssues(item: WorksDraftEntry): ComponentEntryIssue[] {
  const issues: ComponentEntryIssue[] = [];
  if (!item.role.trim()) {
    issues.push({ entryId: item.id, field: "role", message: "Add a role." });
  }
  const period = parseMonthRangePeriod(item.period);
  if (!item.period.trim()) {
    issues.push({ entryId: item.id, field: "period", message: "Add a period." });
  } else if (!period.valid || !period.start) {
    issues.push({ entryId: item.id, field: "period", message: "Choose a valid start month." });
  } else if (!period.ongoing && !period.end) {
    issues.push({
      entryId: item.id,
      field: "period",
      message: "Choose an end month or mark this role as ongoing.",
    });
  } else if (period.end && period.end < period.start) {
    issues.push({
      entryId: item.id,
      field: "period",
      message: "End month must be after the start month.",
    });
  }
  if (!optionalUrlIsValid(item.affiliationUrl)) {
    issues.push({ entryId: item.id, field: "affiliationUrl", message: "Enter a valid URL." });
  }
  return issues;
}

export function publicationEntryIssues(
  item: PublicationDraftEntry,
): ComponentEntryIssue[] {
  const issues: ComponentEntryIssue[] = [];
  if (!item.title.trim()) {
    issues.push({ entryId: item.id, field: "title", message: "Add a title." });
  }
  if (!item.year.trim()) {
    issues.push({ entryId: item.id, field: "year", message: "Add a year or year group." });
  }
  const urlFields: Array<[string, string | undefined]> = [
    ["url", item.url],
    ["doiUrl", item.doiUrl],
    ["arxivUrl", item.arxivUrl],
  ];
  for (const [field, value] of urlFields) {
    if (!optionalUrlIsValid(value)) {
      issues.push({ entryId: item.id, field, message: "Enter a valid URL." });
    }
  }
  return issues;
}

export function parseNewsComponentDraft(source: string): NewsComponentDraft {
  const { frontmatter, body } = componentFrontmatterFromSource(source, "News");
  const items: NewsDraftItem[] = [];
  let cursor = 0;
  let entryIndex = 0;
  let match: RegExpExecArray | null;
  NEWS_ENTRY_RE.lastIndex = 0;
  while ((match = NEWS_ENTRY_RE.exec(body)) !== null) {
    items.push(...parseNewsDividerItems(body.slice(cursor, match.index), `before-${entryIndex}`));
    const attrs = parseNewsAttrs(match[1] ?? "");
    items.push({
      id: normalizeComponentEntryId(attrs.entryId, "news", entryIndex),
      type: "entry",
      date: /^\d{4}-\d{2}-\d{2}$/.test(attrs.date || "") ? attrs.date : todayInHalifax(),
      body: (match[2] ?? "").trim(),
    });
    entryIndex += 1;
    cursor = NEWS_ENTRY_RE.lastIndex;
  }
  items.push(...parseNewsDividerItems(body.slice(cursor), "after"));
  return { frontmatter, items };
}

export function serializeNewsComponentDraft(draft: NewsComponentDraft): string {
  const body = draft.items
    .map((item) => {
      if (item.type === "divider") return "---";
      const date = item.date || todayInHalifax();
      return [
        `<NewsEntry ${compactAttrs([jsxAttr("entryId", item.id), jsxAttr("date", date)])}>`,
        "",
        item.body.trimEnd(),
        "",
        "</NewsEntry>",
      ].join("\n");
    })
    .join("\n\n");
  return [draft.frontmatter.trimEnd(), "", body.trimEnd(), ""].join("\n");
}

export function parseTeachingComponentDraft(source: string): TeachingComponentDraft {
  const { frontmatter } = componentFrontmatterFromSource(source, "Teaching");
  return {
    frontmatter,
    items: parseTeachingEntries(source).map((entry, index) => {
      const { entryId, ...value } = entry;
      return {
        id: normalizeComponentEntryId(entryId, "teaching", index),
        ...value,
      };
    }),
  };
}

export function serializeTeachingComponentDraft(draft: TeachingComponentDraft): string {
  const body = draft.items
    .map((entry) => {
      const attrs = compactAttrs([
        jsxAttr("entryId", entry.id),
        jsxAttr("term", entry.term),
        jsxAttr("period", entry.period),
        jsxAttr("role", entry.role),
        jsxAttr("courseCode", entry.courseCode),
        jsxAttr("courseName", entry.courseName),
        jsxAttr("courseUrl", entry.courseUrl),
        jsxAttr("instructor", entry.instructor),
      ]);
      return `<TeachingEntry ${attrs} />`;
    })
    .join("\n\n");
  return [draft.frontmatter.trimEnd(), "", body.trimEnd(), ""].join("\n");
}

export function parseWorksComponentDraft(source: string): WorksComponentDraft {
  const { frontmatter } = componentFrontmatterFromSource(source, "Works");
  return {
    frontmatter,
    items: parseWorksEntries(source).map((entry, index) => {
      const { entryId, ...value } = entry;
      return {
        id: normalizeComponentEntryId(entryId, "works", index),
        ...value,
      };
    }),
  };
}

export function serializeWorksComponentDraft(draft: WorksComponentDraft): string {
  const body = draft.items
    .map((entry) => {
      const attrs = compactAttrs([
        jsxAttr("entryId", entry.id),
        jsxAttr("category", entry.category),
        jsxAttr("role", entry.role),
        jsxAttr("affiliation", entry.affiliation),
        jsxAttr("affiliationUrl", entry.affiliationUrl),
        jsxAttr("location", entry.location),
        jsxAttr("period", entry.period),
      ]);
      return [
        `<WorksEntry ${attrs}>`,
        "",
        String(entry.body || "").trimEnd(),
        "",
        "</WorksEntry>",
      ].join("\n");
    })
    .join("\n\n");
  return [draft.frontmatter.trimEnd(), "", body.trimEnd(), ""].join("\n");
}

export function parsePublicationsComponentDraft(
  source: string,
): PublicationsComponentDraft {
  const { frontmatter } = componentFrontmatterFromSource(source, "Publications");
  return {
    frontmatter,
    items: parsePublicationsEntries(source).map((entry, index) => {
      const { entryId, ...value } = entry;
      return {
        id: normalizeComponentEntryId(entryId, "publication", index),
        ...value,
      };
    }),
  };
}

export function serializePublicationsComponentDraft(
  draft: PublicationsComponentDraft,
): string {
  const body = draft.items
    .map((entry) => {
      const data = { ...entry, entryId: entry.id, id: undefined };
      return `<PublicationsEntry data='${jsonDataAttr(data)}' />`;
    })
    .join("\n\n");
  return [draft.frontmatter.trimEnd(), "", body.trimEnd(), ""].join("\n");
}

export function moveDraftEntry<T>(items: T[], index: number, direction: -1 | 1) {
  if (index < 0 || index >= items.length) return items;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (!item) return items;
  next.splice(nextIndex, 0, item);
  return next;
}

export function reorderDraftEntries<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
) {
  if (!sourceId || !targetId || sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;
  const next = [...items];
  const [source] = next.splice(sourceIndex, 1);
  if (!source) return items;
  const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.splice(adjustedTarget, 0, source);
  return next;
}

export function componentEntryDomId(id: string) {
  return `component-entry-${id.replace(/[^a-z0-9_-]/gi, "-")}`;
}

export function componentEntryFingerprint(value: unknown) {
  return JSON.stringify(value);
}

export function componentEntryState(
  baselineFingerprints: ReadonlyMap<string, string>,
  item: { id: string },
) {
  const baseline = baselineFingerprints.get(item.id);
  if (!baseline) return "New";
  return baseline === componentEntryFingerprint(item) ? "Saved" : "Edited";
}

export function componentItemMatches(
  search: string,
  values: Array<string | undefined>,
) {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  return values.some((value) => String(value || "").toLocaleLowerCase().includes(query));
}

export function componentConflictDetail(
  name: SiteComponentName,
  baselineSource: string,
  localSource: string,
  remoteSource: string,
) {
  const baseline = componentDraftItemsForSource(name, baselineSource);
  const localChanged = changedComponentEntryIds(
    baseline,
    componentDraftItemsForSource(name, localSource),
  );
  const remoteChanged = changedComponentEntryIds(
    baseline,
    componentDraftItemsForSource(name, remoteSource),
  );
  const overlaps = [...localChanged].filter((id) => remoteChanged.has(id));
  if (overlaps.length > 0) {
    return `${overlaps.length} ${overlaps.length === 1 ? "entry was" : "entries were"} edited in both versions. Compare before choosing which version to keep.`;
  }
  if (localChanged.size > 0 && remoteChanged.size > 0) {
    return "Your edits and the latest saved edits touch different entries, but the collection changed in both places. Compare the versions before continuing.";
  }
  return "The collection changed after you opened it. Compare both versions before choosing which content should become the latest Draft.";
}

function optionalUrlIsValid(value: string | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeComponentEntryId(
  value: string | undefined,
  prefix: string,
  index: number,
) {
  const candidate = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(candidate)
    ? candidate
    : `${prefix}-${index + 1}`;
}

function parseNewsAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of String(raw || "").matchAll(NEWS_ATTR_RE)) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function componentFrontmatterFromSource(
  source: string,
  fallbackTitle: string,
): { frontmatter: string; body: string } {
  const normalized = String(source || "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n[\s\S]*?\n---\n*/);
  if (!match) {
    return {
      frontmatter: ["---", `title: ${JSON.stringify(fallbackTitle)}`, "---"].join("\n"),
      body: normalized.trim(),
    };
  }
  return {
    frontmatter: match[0].trimEnd(),
    body: normalized.slice(match[0].length),
  };
}

function parseNewsDividerItems(segment: string, prefix: string): NewsDraftDivider[] {
  return String(segment || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line === "---" || line === "***" || /^<hr\s*\/?>$/i.test(line))
    .map(({ index }) => ({ id: `${prefix}-divider-${index}`, type: "divider" as const }));
}

function jsxAttr(name: string, value: string | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `${name}="${escaped}"`;
}

function compactAttrs(attrs: string[]) {
  return attrs.filter(Boolean).join(" ");
}

function jsonDataAttr(value: unknown) {
  return JSON.stringify(value).replace(/'/g, "\\u0027");
}

function componentDraftItemsForSource(name: SiteComponentName, source: string) {
  if (name === "news") return parseNewsComponentDraft(source).items;
  if (name === "teaching") return parseTeachingComponentDraft(source).items;
  if (name === "works") return parseWorksComponentDraft(source).items;
  return parsePublicationsComponentDraft(source).items;
}

function changedComponentEntryIds(
  baseline: Array<{ id: string }>,
  candidate: Array<{ id: string }>,
) {
  const baselineMap = new Map(
    baseline.map((item) => [item.id, componentEntryFingerprint(item)]),
  );
  const candidateMap = new Map(
    candidate.map((item) => [item.id, componentEntryFingerprint(item)]),
  );
  return new Set(
    [...new Set([...baselineMap.keys(), ...candidateMap.keys()])].filter(
      (id) => baselineMap.get(id) !== candidateMap.get(id),
    ),
  );
}
